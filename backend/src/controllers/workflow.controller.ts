/**
 * @fileoverview Contrôleur Workflow - Gestion des instances d'agents
 * 
 * Implémente les opérations transactionnelles critiques :
 * - Création atomique Instance + Node
 * - Suppression cascade (Node → Instance → Journals)
 * - Mise à jour partielle optimisée
 * 
 * @see Guides/WIP/PLAN_CORRECTIF_PERSISTANCE_WORKFLOW.md
 * @see Guides/WIP/PERSISTANCES_ROUTES.md
 */

import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Workflow } from '../models/Workflow.model';
import { AgentInstance, IAgentInstance } from '../models/AgentInstance.model';
import { WorkflowNodeV2, IWorkflowNodeV2 } from '../models/WorkflowNodeV2.model';
import { AgentJournal } from '../models/AgentJournal.model';
import { WorkflowEdge } from '../models/WorkflowEdge.model';
import { AgentInstanceDeletionPolicyService } from '../services/agentInstanceDeletionPolicy.service';
import type { DeleteAgentInstancePolicyAudit } from '../services/agentInstanceDeletionPolicy.service';
import {
    CreateInstanceRequestBody,
    CreateInstanceResponse,
    sanitizePersistenceConfigForInstanceEgress,
} from '../types/persistence';
import { IUser } from '../models/User.model';
import { CanonicalRobotIdEnum, DEFAULT_ROBOT_ID } from '../types/robotIds';
import { WorkflowRepository } from '../repositories/WorkflowRepository';
import { CreateWorkflowInstanceUseCase } from '../application/workflows/createWorkflowInstance.usecase';

// ============================================
// SCHÉMAS DE VALIDATION ZOD
// ============================================

const ToolConfigSchema = z.object({
    name: z.string().min(1),
    enabled: z.boolean().default(true),
    parameters: z.record(z.string(),z.unknown()).optional()
});

const AgentConfigurationSchema = z.object({
    llmProvider: z.string().min(1),
    llmModel: z.string().min(1),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().positive().optional(),
    systemPrompt: z.string().optional(),
    tools: z.array(ToolConfigSchema).optional(),
    historyConfig: z.object({
        maxMessages: z.number().positive().optional(),
        summarizeAfter: z.number().positive().optional()
    }).optional(),
    outputConfig: z.record(z.string(),z.unknown()).optional()
});

const PersistenceOptionsSchema = z.object({
    // ⭐ New properties
    saveChat: z.boolean().optional(),
    saveChatHistory: z.boolean().optional(),
    saveErrors: z.boolean().optional(),
    saveTasks: z.boolean().optional(),
    saveTaskExecution: z.boolean().optional(),
    saveLinks: z.boolean().optional(),
    saveMedia: z.boolean().optional(),
    allowWorkspaceWrite: z.boolean().optional(),
    mediaStorage: z.enum(['db', 'local', 'cloud']).optional(),
    saveHistorySummary: z.boolean().optional(),
    // ⭐ Legacy properties (backward compatibility)
    mediaStorageMode: z.enum(['database', 'local', 'cloud']).optional(),
    summarizeHistory: z.boolean().optional(),
    retentionDays: z.number().positive().optional()
});

const PositionSchema = z.object({
    x: z.number(),
    y: z.number()
});

const CreateInstanceBodySchema = z.object({
    agentConfig: z.object({
        name: z.string().min(1).max(100),
        role: z.string().min(1).max(200),
        prototypeId: z.string().optional(),
        robotId: CanonicalRobotIdEnum.default(DEFAULT_ROBOT_ID),
        configuration: AgentConfigurationSchema
    }),
    persistenceOptions: PersistenceOptionsSchema.optional(),
    position: PositionSchema
});

const DeleteNodeQuerySchema = z.object({
    mediaPolicy: z.enum(['delete_media', 'orphan_media']).optional().default('delete_media')
});

// ============================================
// TYPES
// ============================================

interface AuthenticatedRequest extends Request {
    user: IUser;
}

function isTransactionUnsupported(error: unknown): boolean {
    const errorCode = typeof error === 'object' && error !== null && 'code' in error
        ? (error as { code?: number }).code
        : undefined;
    const message = error instanceof Error ? error.message : '';

    return errorCode === 20 || message.includes('Transaction numbers are only allowed');
}

// ============================================
// CONTRÔLEUR
// ============================================

export class WorkflowController {
    /**
     * POST /api/workflows/:id/instances
     * 
     * Création atomique d'une instance d'agent et de son nœud visuel.
     * Utilise une transaction MongoDB pour garantir la cohérence.
     */
    static async createInstance(
        req: AuthenticatedRequest,
        res: Response
    ): Promise<void> {
        const session = await mongoose.startSession();
        
        try {
            const workflowId = req.params.id;
            const user = req.user;

            // Validation du body
            const parseResult = CreateInstanceBodySchema.safeParse(req.body);
            if (!parseResult.success) {
                res.status(400).json({
                    error: 'Validation error',
                    details: parseResult.error.flatten()
                });
                return;
            }

            const body = parseResult.data;

            session.startTransaction();

            const workflowRepository = new WorkflowRepository();
            const createWorkflowInstanceUseCase = new CreateWorkflowInstanceUseCase(
                workflowRepository,
                AgentInstance,
                WorkflowNodeV2,
                AgentJournal,
            );

            try {
                const result = await createWorkflowInstanceUseCase.execute(
                    {
                        workflowId,
                        userId: user.id,
                        body: {
                            agentConfig: {
                                ...body.agentConfig,
                                robotId: body.agentConfig.robotId || DEFAULT_ROBOT_ID,
                            },
                            persistenceOptions: body.persistenceOptions,
                            position: body.position,
                        },
                    },
                    session,
                );

                if (result.kind === 'not_found') {
                    await session.abortTransaction();
                    res.status(404).json({ error: 'Workflow introuvable' });
                    return;
                }

                const response: CreateInstanceResponse = {
                    instance: {
                        _id: result.instance._id.toString(),
                        name: result.instance.name,
                        role: result.instance.role,
                        status: result.instance.status,
                        persistenceConfig: sanitizePersistenceConfigForInstanceEgress(result.instance.persistenceConfig),
                        configuration_json: {
                            llmProvider: result.instance.llmProvider,
                            llmModel: result.instance.llmModel,
                            systemPrompt: result.instance.systemPrompt,
                            role: result.instance.role,
                            tools: result.instance.tools || [],
                            capabilities: result.instance.capabilities || [],
                            outputConfig: result.instance.outputConfig,
                            historyConfig: result.instance.historyConfig
                        }
                    },
                    node: {
                        _id: result.node._id.toString(),
                        instanceId: result.instance._id.toString(),
                        position: result.node.position
                    }
                };

                console.log(`[WorkflowController] Instance créée: ${result.instance._id} dans workflow ${workflowId}`);
                res.status(201).json(response);
            } catch (transactionError) {
                await session.abortTransaction();
                throw transactionError;
            }

        } catch (error) {
            console.error('[WorkflowController] createInstance error:', error);
            
            if (error instanceof mongoose.Error.ValidationError) {
                res.status(400).json({
                    error: 'Validation error',
                    details: error.message
                });
                return;
            }

            res.status(500).json({
                error: 'Erreur création instance',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        } finally {
            session.endSession();
        }
    }

    /**
     * DELETE /api/workflows/:id/nodes/:nodeId
     * 
     * Suppression en cascade transactionnelle :
     * - WorkflowNode
     * - AgentInstance (si type agent)
     * - AgentJournals liés selon politique media
     * - WorkflowEdges connectés
     * - Médias supprimés ou orphelinés selon politique
     */
    static async deleteNode(
        req: AuthenticatedRequest,
        res: Response
    ): Promise<void> {
        const session = await mongoose.startSession();

        try {
            const { id: workflowId, nodeId } = req.params;
            const user = req.user;
            const queryParseResult = DeleteNodeQuerySchema.safeParse(req.query);

            if (!queryParseResult.success) {
                res.status(400).json({
                    error: 'Validation error',
                    details: queryParseResult.error.flatten()
                });
                return;
            }

            // Vérifier le workflow
            const workflow = await Workflow.findOne({
                _id: workflowId,
                userId: user.id
            });

            if (!workflow) {
                res.status(404).json({ error: 'Workflow introuvable' });
                return;
            }

            // Trouver le nœud
            const node = await WorkflowNodeV2.findOne({
                _id: nodeId,
                workflowId,
                ownerId: user.id
            });

            if (!node) {
                res.status(404).json({ error: 'Nœud introuvable' });
                return;
            }

            try {
                const deletionPolicyService = new AgentInstanceDeletionPolicyService();

                const executeDelete = async (useSession: boolean) => {
                    let deletedInstanceId: string | null = null;
                    let journalsDeleted = 0;
                    let mediaDeleted = 0;
                    let mediaReferencesDeleted = 0;
                    let mediaReferencesOrphaned = 0;
                    let retainedMediaEntries = 0;
                    let mediaPolicy: 'delete_media' | 'orphan_media' | null = null;
                    let audit: DeleteAgentInstancePolicyAudit | null = null;

                    if (node.nodeType === 'agent' && node.instanceId) {
                        deletedInstanceId = node.instanceId.toString();
                        mediaPolicy = queryParseResult.data.mediaPolicy;

                        const deletionResult = await deletionPolicyService.deleteInstanceWithPolicy({
                            userId: user.id,
                            workflowId,
                            instanceId: deletedInstanceId,
                            mediaPolicy,
                            session: useSession ? session : undefined,
                            deleteInstance: false,
                            persistAudit: false,
                            auditOrigin: 'workflow_v2_node_delete_route',
                            triggeredBy: user.id,
                        });

                        journalsDeleted = deletionResult.journalsDeleted;
                        mediaDeleted = deletionResult.mediaFilesDeleted;
                        mediaReferencesDeleted = deletionResult.mediaReferencesDeleted;
                        mediaReferencesOrphaned = deletionResult.mediaReferencesOrphaned;
                        retainedMediaEntries = deletionResult.retainedMediaEntries;
                        audit = deletionResult.audit;

                        if (useSession) {
                            await AgentInstance.deleteOne({ _id: node.instanceId }, { session });
                        } else {
                            await AgentInstance.deleteOne({ _id: node.instanceId });
                        }
                    }

                    const edgeDeleteQuery = {
                        workflowId,
                        $or: [
                            { sourceNodeId: nodeId },
                            { targetNodeId: nodeId }
                        ]
                    };

                    const edgesDeleted = useSession
                        ? await WorkflowEdge.deleteMany(edgeDeleteQuery, { session })
                        : await WorkflowEdge.deleteMany(edgeDeleteQuery);

                    if (useSession) {
                        await WorkflowNodeV2.deleteOne({ _id: nodeId }, { session });
                    } else {
                        await WorkflowNodeV2.deleteOne({ _id: nodeId });
                    }

                    return {
                        deletedInstanceId,
                        journalsDeleted,
                        mediaDeleted,
                        mediaReferencesDeleted,
                        mediaReferencesOrphaned,
                        retainedMediaEntries,
                        mediaPolicy,
                        audit,
                        edgesDeleted: edgesDeleted.deletedCount || 0,
                    };
                };

                let deleteResult: Awaited<ReturnType<typeof executeDelete>>;

                try {
                    session.startTransaction();
                    await Workflow.findById(workflowId).session(session);
                    deleteResult = await executeDelete(true);
                    await session.commitTransaction();
                } catch (transactionError) {
                    if (session.inTransaction()) {
                        await session.abortTransaction();
                    }

                    if (!isTransactionUnsupported(transactionError)) {
                        throw transactionError;
                    }

                    deleteResult = await executeDelete(false);
                }

                if (deleteResult.audit) {
                    const persistedAudit = await deletionPolicyService.persistDeletionAudit(deleteResult.audit);
                    deleteResult.audit.journalId = persistedAudit.journalId;
                    deleteResult.audit.persistenceError = persistedAudit.persistenceError;
                }

                console.log(`[WorkflowController] Nœud supprimé: ${nodeId}`, {
                    deletedInstanceId: deleteResult.deletedInstanceId,
                    journalsDeleted: deleteResult.journalsDeleted,
                    mediaDeleted: deleteResult.mediaDeleted,
                    edgesDeleted: deleteResult.edgesDeleted,
                });

                res.json({
                    success: true,
                    deletedNodeId: nodeId,
                    deletedInstanceId: deleteResult.deletedInstanceId,
                    mediaPolicy: deleteResult.mediaPolicy,
                    audit: deleteResult.audit ? {
                        journalId: deleteResult.audit.journalId || null,
                        severity: deleteResult.audit.severity,
                        anomalyCount: deleteResult.audit.anomalyCount,
                        anomalyCodes: deleteResult.audit.anomalies.map((anomaly) => anomaly.code),
                        origin: deleteResult.audit.origin,
                    } : null,
                    deletedCounts: {
                        journals: deleteResult.journalsDeleted,
                        edges: deleteResult.edgesDeleted,
                        mediaFiles: deleteResult.mediaDeleted,
                        mediaReferencesDeleted: deleteResult.mediaReferencesDeleted,
                        mediaReferencesOrphaned: deleteResult.mediaReferencesOrphaned,
                        retainedMediaEntries: deleteResult.retainedMediaEntries,
                    }
                });

            } catch (transactionError) {
                if (session.inTransaction()) {
                    await session.abortTransaction();
                }
                throw transactionError;
            }

        } catch (error) {
            console.error('[WorkflowController] deleteNode error:', error);
            res.status(500).json({
                error: 'Erreur suppression nœud',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        } finally {
            session.endSession();
        }
    }

    /**
     * GET /api/workflows/:id (Version légère)
     * 
     * Récupère uniquement la structure visuelle du workflow :
     * - Workflow metadata
     * - Nodes (sans charger les instances complètes)
     * - Edges
     */
    static async getWorkflowGraph(
        req: AuthenticatedRequest,
        res: Response
    ): Promise<void> {
        try {
            const workflowId = req.params.id;
            const user = req.user;

            const workflow = await Workflow.findOne({
                _id: workflowId,
                userId: user.id
            });

            if (!workflow) {
                res.status(404).json({ error: 'Workflow introuvable' });
                return;
            }

            // Charger nœuds et edges en parallèle
            const [nodes, edges] = await Promise.all([
                WorkflowNodeV2.find({ workflowId }).lean(),
                WorkflowEdge.find({ workflowId }).lean()
            ]);

            // Transformer les nœuds pour React Flow
            const transformedNodes = nodes.map(node => ({
                id: node._id.toString(),
                type: node.nodeType,
                position: node.position,
                data: {
                    instanceId: node.instanceId?.toString(),
                    ...node.uiConfig
                }
            }));

            // Transformer les edges pour React Flow
            const transformedEdges = edges.map(edge => ({
                id: edge._id.toString(),
                source: (edge as unknown as { sourceNodeId: mongoose.Types.ObjectId }).sourceNodeId?.toString(),
                target: (edge as unknown as { targetNodeId: mongoose.Types.ObjectId }).targetNodeId?.toString(),
                ...(edge as unknown as { edgeData?: Record<string, unknown> }).edgeData
            }));

            res.json({
                workflow: {
                    _id: workflow._id,
                    name: workflow.name,
                    description: workflow.description,
                    isDirty: workflow.isDirty,
                    canvasState: workflow.canvasState,
                    lastSavedAt: workflow.lastSavedAt
                },
                nodes: transformedNodes,
                edges: transformedEdges
            });

        } catch (error) {
            console.error('[WorkflowController] getWorkflowGraph error:', error);
            res.status(500).json({
                error: 'Erreur récupération workflow',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * PATCH /api/workflows/:id/nodes/:nodeId
     * 
     * Mise à jour partielle d'un nœud (position, uiConfig).
     * Optimisé pour les updates fréquents de position lors du drag.
     */
    static async updateNode(
        req: AuthenticatedRequest,
        res: Response
    ): Promise<void> {
        try {
            const { id: workflowId, nodeId } = req.params;
            const user = req.user;
            const { position, uiConfig } = req.body;

            // Construction de l'update
            const updateFields: Record<string, unknown> = {};

            if (position && typeof position.x === 'number' && typeof position.y === 'number') {
                updateFields.position = position;
            }

            if (uiConfig && typeof uiConfig === 'object') {
                // Merge avec l'existant via dot notation
                for (const [key, value] of Object.entries(uiConfig)) {
                    updateFields[`uiConfig.${key}`] = value;
                }
            }

            if (Object.keys(updateFields).length === 0) {
                res.status(400).json({ error: 'Aucun champ à mettre à jour' });
                return;
            }

            const result = await WorkflowNodeV2.findOneAndUpdate(
                {
                    _id: nodeId,
                    workflowId,
                    ownerId: user.id
                },
                { $set: updateFields },
                { new: true }
            );

            if (!result) {
                res.status(404).json({ error: 'Nœud introuvable' });
                return;
            }

            res.json({ success: true, node: result });

        } catch (error) {
            console.error('[WorkflowController] updateNode error:', error);
            res.status(500).json({
                error: 'Erreur mise à jour nœud',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
}

// ============================================
// EXPORT DES HANDLERS POUR ROUTES
// ============================================

export const createInstance = WorkflowController.createInstance;
export const deleteNode = WorkflowController.deleteNode;
export const getWorkflowGraph = WorkflowController.getWorkflowGraph;
export const updateNode = WorkflowController.updateNode;

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
import { getMediaStorageService } from '../services/mediaStorage.service';
import {
    CreateInstanceRequestBody,
    CreateInstanceResponse,
    DEFAULT_PERSISTENCE_CONFIG,
    PersistenceConfig,
    AgentInstanceConfiguration
} from '../types/persistence';
import { IUser } from '../models/User.model';

// ============================================
// SCHÉMAS DE VALIDATION ZOD
// ============================================

const ToolConfigSchema = z.object({
    name: z.string().min(1),
    enabled: z.boolean().default(true),
    parameters: z.record(z.unknown()).optional()
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
    outputConfig: z.record(z.unknown()).optional()
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
        robotId: z.enum(['AR_001', 'BOS_001', 'COM_001', 'PHIL_001', 'TIM_001']).default('AR_001'),
        configuration: AgentConfigurationSchema
    }),
    persistenceOptions: PersistenceOptionsSchema.optional(),
    position: PositionSchema
});

// ============================================
// TYPES
// ============================================

interface AuthenticatedRequest extends Request {
    user: IUser;
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

            // Vérifier que le workflow existe et appartient à l'utilisateur
            const workflow = await Workflow.findOne({
                _id: workflowId,
                userId: user.id
            });

            if (!workflow) {
                res.status(404).json({ error: 'Workflow introuvable' });
                return;
            }

            // Démarrer la transaction
            session.startTransaction();

            try {
                // 1. Créer l'instance d'agent
                const persistenceConfig: PersistenceConfig = {
                    ...DEFAULT_PERSISTENCE_CONFIG,
                    ...body.persistenceOptions
                };

                // ✅ ÉTAPE 1: Créer en AgentInstance (table réelle, pas V2)
                const config = body.agentConfig.configuration;
                
                const instanceData = {
                    workflowId: new mongoose.Types.ObjectId(workflowId),
                    userId: new mongoose.Types.ObjectId(user.id),
                    prototypeId: body.agentConfig.prototypeId
                        ? new mongoose.Types.ObjectId(body.agentConfig.prototypeId)
                        : undefined,
                    
                    // ✅ Identifiant d'exécution unique
                    executionId: `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    
                    // ✅ Snapshot du prototype (config du moment de la création)
                    name: body.agentConfig.name,
                    role: body.agentConfig.role,
                    robotId: body.agentConfig.robotId,
                    llmProvider: config.llmProvider || 'openai',
                    llmModel: config.llmModel || 'gpt-4',
                    systemPrompt: config.systemPrompt || '',
                    tools: config.tools || [],
                    // ✅ Capabilities initialisé à vide (pas dans le schema input)
                    capabilities: [],
                    outputConfig: config.outputConfig,
                    historyConfig: config.historyConfig,
                    
                    // ✅ Canvas properties
                    position: body.position,
                    isMinimized: false,
                    isMaximized: false,
                    zIndex: 0,
                    
                    // ✅ Contenu et métriques
                    content: [],
                    metrics: {
                        executionCount: 0,
                        totalTokensUsed: 0,
                        averageResponseTime: 0,
                        lastExecutionTime: new Date(),
                        errorCount: 0
                    },
                    
                    // ✅ État
                    status: 'running',
                    persistenceConfig
                };

                const [instance] = await AgentInstance.create([instanceData], { session });

                // 2. Créer le nœud visuel lié
                const nodeData = {
                    workflowId: new mongoose.Types.ObjectId(workflowId),
                    ownerId: new mongoose.Types.ObjectId(user.id),
                    instanceId: instance._id,
                    nodeType: 'agent' as const,
                    position: body.position,
                    uiConfig: {
                        label: body.agentConfig.name,
                        expanded: true
                    }
                };

                const [node] = await WorkflowNodeV2.create([nodeData], { session });

                // 3. Logger l'événement système dans le journal
                await AgentJournal.create([{
                    agentInstanceId: instance._id,
                    workflowId: new mongoose.Types.ObjectId(workflowId),
                    type: 'system',
                    severity: 'info',
                    payload: {
                        event: 'instance_created',
                        details: {
                            name: instance.name,
                            role: instance.role,
                            nodeId: node._id.toString()
                        },
                        triggeredBy: user.id
                    },
                    timestamp: new Date()
                }], { session });

                // 4. Commit la transaction
                await session.commitTransaction();

                // 5. Préparer la réponse
                const response: CreateInstanceResponse = {
                    instance: {
                        _id: instance._id.toString(),
                        name: instance.name,
                        role: instance.role,
                        status: instance.status,
                        persistenceConfig: instance.persistenceConfig,
                        // ✅ ÉTAPE 1: Inclure configuration complète pour le frontend
                        configuration_json: {
                            llmProvider: instance.llmProvider,
                            llmModel: instance.llmModel,
                            systemPrompt: instance.systemPrompt,
                            role: instance.role,
                            tools: instance.tools || [],
                            capabilities: instance.capabilities || [],
                            outputConfig: instance.outputConfig,
                            historyConfig: instance.historyConfig
                        }
                    },
                    node: {
                        _id: node._id.toString(),
                        instanceId: instance._id.toString(),
                        position: node.position
                    }
                };

                console.log(`[WorkflowController] Instance créée: ${instance._id} dans workflow ${workflowId}`);
                res.status(201).json(response);

            } catch (transactionError) {
                // Rollback en cas d'erreur
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
     * - AgentJournals liés
     * - WorkflowEdges connectés
     * - Fichiers média locaux
     */
    static async deleteNode(
        req: AuthenticatedRequest,
        res: Response
    ): Promise<void> {
        const session = await mongoose.startSession();

        try {
            const { id: workflowId, nodeId } = req.params;
            const user = req.user;

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

            session.startTransaction();

            try {
                let deletedInstanceId: string | null = null;
                let journalsDeleted = 0;
                let mediaDeleted = 0;

                // Si c'est un nœud agent, supprimer l'instance et les journaux
                if (node.nodeType === 'agent' && node.instanceId) {
                    deletedInstanceId = node.instanceId.toString();

                    // Supprimer les fichiers média locaux d'abord
                    const mediaService = getMediaStorageService();
                    mediaDeleted = await mediaService.deleteAgentMedia(
                        user.id,
                        workflowId,
                        deletedInstanceId
                    );

                    // Supprimer les journaux
                    journalsDeleted = await AgentJournal.deleteByInstance(node.instanceId);

                    // ✅ Supprimer l'instance en AgentInstance (pas V2)
                    await AgentInstance.deleteOne(
                        { _id: node.instanceId },
                        { session }
                    );
                }

                // Supprimer les edges connectés à ce nœud
                const edgesDeleted = await WorkflowEdge.deleteMany({
                    workflowId,
                    $or: [
                        { sourceNodeId: nodeId },
                        { targetNodeId: nodeId }
                    ]
                }, { session });

                // Supprimer le nœud
                await WorkflowNodeV2.deleteOne({ _id: nodeId }, { session });

                await session.commitTransaction();

                console.log(`[WorkflowController] Nœud supprimé: ${nodeId}`, {
                    deletedInstanceId,
                    journalsDeleted,
                    mediaDeleted,
                    edgesDeleted: edgesDeleted.deletedCount
                });

                res.json({
                    success: true,
                    deletedNodeId: nodeId,
                    deletedInstanceId,
                    deletedCounts: {
                        journals: journalsDeleted,
                        edges: edgesDeleted.deletedCount || 0,
                        mediaFiles: mediaDeleted
                    }
                });

            } catch (transactionError) {
                await session.abortTransaction();
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

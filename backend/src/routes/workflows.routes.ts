import { Router, Request, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Workflow } from '../models/Workflow.model';
import { AgentInstance } from '../models/AgentInstance.model';
import { WorkflowEdge } from '../models/WorkflowEdge.model';
import { User, IUser } from '../models/User.model';
import { WorkflowNodeV2 } from '../models/WorkflowNodeV2.model'; // ⭐ PERF: Top-level import instead of dynamic require
import { requireAuth, requireOwnershipAsync } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import { WorkflowSelfHealingService } from '../services/workflowSelfHealing.service';
import { buildWorkspaceSnapshot } from '../utils/workspaceSnapshot';
import { CreateWorkflowUseCase } from '../application/workflows/createWorkflow.usecase';
import { DeleteWorkflowUseCase, DeleteWorkflowUseCaseError } from '../application/workflows/deleteWorkflow.usecase';
import { ListUserWorkflowsUseCase } from '../application/workflows/listUserWorkflows.usecase';
import { MarkWorkflowDirtyUseCase } from '../application/workflows/markWorkflowDirty.usecase';
import { PatchWorkflowUseCase } from '../application/workflows/patchWorkflow.usecase';
import { SaveWorkflowUseCase } from '../application/workflows/saveWorkflow.usecase';
import { SelectWorkflowUseCase } from '../application/workflows/selectWorkflow.usecase';
import { UpdateWorkflowUseCase } from '../application/workflows/updateWorkflow.usecase';
import { AgentInstanceRepository } from '../repositories/AgentInstanceRepository';
import { UserRepository } from '../repositories/UserRepository';
import { WorkflowRepository } from '../repositories/WorkflowRepository';
import { WorkflowValidationError, WorkflowValidator } from '../validators/workflow-validator';

// ⭐ V2 IMPORTS - Nouvelle architecture de persistance (Jalon 1-2)
import {
    createInstance,
    deleteNode,
    getWorkflowGraph,
    updateNode
} from '../controllers/workflow.controller';

const router = Router();

const workflowRepository = new WorkflowRepository();
const userRepository = new UserRepository();
const agentInstanceRepository = new AgentInstanceRepository();
const workflowValidator = new WorkflowValidator();
const listUserWorkflowsUseCase = new ListUserWorkflowsUseCase(
    workflowRepository,
    userRepository,
    agentInstanceRepository,
);
const createWorkflowUseCase = new CreateWorkflowUseCase(
    workflowRepository,
    userRepository,
);
const updateWorkflowUseCase = new UpdateWorkflowUseCase(
    workflowRepository,
    userRepository,
    workflowValidator,
);
const selectWorkflowUseCase = new SelectWorkflowUseCase(
    workflowRepository,
    userRepository,
    workflowValidator,
);
const deleteWorkflowUseCase = new DeleteWorkflowUseCase(
    workflowRepository,
    userRepository,
);
const saveWorkflowUseCase = new SaveWorkflowUseCase(workflowRepository);
const patchWorkflowUseCase = new PatchWorkflowUseCase(workflowRepository);
const markWorkflowDirtyUseCase = new MarkWorkflowDirtyUseCase(workflowRepository);

const legacyWorkflowV1UsageCounters = {
    nodePositionPatch: 0,
    edgeCreate: 0,
    edgeDelete: 0,
};

function markLegacyWorkflowV1Usage(
    res: Response,
    routeKey: keyof typeof legacyWorkflowV1UsageCounters,
    workflowId: string,
    detailId?: string,
) {
    legacyWorkflowV1UsageCounters[routeKey] += 1;

    res.setHeader('Warning', '299 - "Deprecated workflow V1 route. Migrate to V2 workflow graph APIs."');
    res.setHeader('X-Workflow-Legacy-Route', routeKey);
    res.setHeader('X-Workflow-Legacy-Count', String(legacyWorkflowV1UsageCounters[routeKey]));

    console.warn('[Workflows][DeprecatedV1Route]', {
        routeKey,
        workflowId,
        detailId: detailId || null,
        usageCount: legacyWorkflowV1UsageCounters[routeKey],
    });
}

// Schema validation
const createWorkflowSchema = z.object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional()
});

const updateWorkflowSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    isActive: z.boolean().optional(),
    isDefault: z.boolean().optional()   // ⭐ V4: Permet de changer le workflow par défaut via édition
});

// GET /api/workflows - Liste des workflows + SYNCHRONOUS IDEMPOTENT MIGRATION
router.get('/', requireAuth, async (req, res) => {
    try {
        const user = req.user as IUser;
        const userId = user._id.toString();

        console.log(`[Workflows GET] User: ${userId}`);

        const result = await listUserWorkflowsUseCase.execute({
            userId,
            currentDefaultWorkflowId: user.defaultWorkflowId?.toString() || null,
        });

        console.log(`[Workflows] Returning ${result.workflows.length} workflows`, {
            repairAction: result.repairAction,
            userId,
        });
        res.json({ workflows: result.workflows });
    } catch (error) {
        console.error('[Workflows] GET error:', error);
        res.status(500).json({ error: 'Erreur récupération workflows' });
    }
});

// GET /api/workflows/:id - Workflow spécifique avec agents et edges
router.get('/:id',
    requireAuth,
    requireOwnershipAsync(async (req) => {
        const workflow = await Workflow.findById(req.params.id);
        return workflow ? workflow.userId.toString() : null;
    }),
    async (req, res) => {
        try {
            const workflow = await Workflow.findById(req.params.id);

            if (!workflow) {
                return res.status(404).json({ error: 'Workflow introuvable' });
            }

            // Charger agents et edges du workflow
            const [agents, edges] = await Promise.all([
                AgentInstance.find({ workflowId: workflow.id }),
                WorkflowEdge.find({ workflowId: workflow.id })
            ]);

            res.json({
                workflow,
                agents,
                edges
            });
        } catch (error) {
            console.error('[Workflows] GET/:id error:', error);
            res.status(500).json({ error: 'Erreur récupération workflow' });
        }
    }
);

// POST /api/workflows - Créer nouveau workflow
// ⭐ V4 FIX: Transactions retirées (MongoDB standalone ne supporte pas les transactions)
// Opérations séquentielles suffisantes — self-healing corrige les incohérences éventuelles
router.post('/', requireAuth, validateRequest(createWorkflowSchema), async (req, res) => {
    try {
        const user = req.user as IUser;
        const userId = user._id.toString();

        console.log(`[Workflows POST] Creating workflow for user: ${userId}`);

        const newWorkflow = await createWorkflowUseCase.execute({
            userId,
            name: req.body.name,
            description: req.body.description,
        });

        console.log(`[Workflows POST] Created workflow: ${newWorkflow._id}`);

        res.status(201).json(newWorkflow);
        
    } catch (error) {
        console.error('[Workflows POST] Error:', error);
        res.status(500).json({ error: 'Erreur création workflow', details: error instanceof Error ? error.message : String(error) });
    }
});

// PUT /api/workflows/:id - Mettre à jour workflow
router.put('/:id',
    requireAuth,
    async (req, res, next) => {
        // ⭐ SELF-HEALING: Validation stricte de l'ID AVANT ownership check
        const workflowId = req.params.id;
        
        // Rejeter les IDs placeholder
        if (WorkflowSelfHealingService.isPlaceholderId(workflowId)) {
            return res.status(400).json({ 
                error: 'Invalid workflow ID',
                message: `"${workflowId}" is a placeholder ID. Please use a valid MongoDB ObjectId.`,
                code: 'INVALID_WORKFLOW_ID',
                hint: 'The frontend should fetch the real workflow ID from GET /api/user/workspace first.'
            });
        }
        
        // Valider format ObjectId
        if (!mongoose.Types.ObjectId.isValid(workflowId)) {
            return res.status(400).json({ 
                error: 'Invalid workflow ID format',
                message: `"${workflowId}" is not a valid MongoDB ObjectId.`,
                code: 'INVALID_OBJECT_ID'
            });
        }
        
        next();
    },
    requireOwnershipAsync(async (req) => {
        const workflow = await Workflow.findById(req.params.id);
        return workflow ? workflow.userId.toString() : null;
    }),
    validateRequest(updateWorkflowSchema),
    async (req, res) => {
        try {
            const user = req.user as IUser;
            const workflow = await updateWorkflowUseCase.execute({
                workflowId: req.params.id,
                userId: user.id,
                updates: req.body,
            });

            if (!workflow) {
                return res.status(404).json({ error: 'Workflow introuvable' });
            }

            res.json(workflow);
        } catch (error) {
            if (error instanceof WorkflowValidationError) {
                return res.status(422).json({
                    error: 'Workflow IR invalide',
                    code: 'INVALID_WORKFLOW_IR',
                    issues: error.issues,
                });
            }

            console.error('[Workflows] PUT error:', error);
            res.status(500).json({ error: 'Erreur mise à jour workflow' });
        }
    }
);

// DELETE /api/workflows/:id - Supprimer workflow (cascade atomique)
router.delete('/:id',
    requireAuth,
    requireOwnershipAsync(async (req) => {
        const workflow = await Workflow.findById(req.params.id);
        return workflow ? workflow.userId.toString() : null;
    }),
    // ⭐ V4 FIX: Transactions retirées (MongoDB standalone)
    async (req, res) => {
        try {
            const user = req.user as IUser;
            const result = await deleteWorkflowUseCase.execute({
                workflowId: req.params.id,
                userId: user.id,
            });

            if (!result) {
                return res.status(404).json({ error: 'Workflow introuvable' });
            }

            res.json({
                success: true,
                message: 'Workflow supprimé avec succès',
                deletedWorkflowId: result.deletedWorkflowId,
                cascade: result.cascade,
            });
        } catch (error) {
            if (error instanceof DeleteWorkflowUseCaseError) {
                return res.status(400).json({
                    error: 'Impossible de supprimer le seul workflow',
                    code: error.code,
                    message: error.message,
                });
            }

            console.error('[Workflows] DELETE error:', error);
            res.status(500).json({ 
                error: 'Erreur suppression workflow',
                details: error instanceof Error ? error.message : String(error)
            });
        }
    }
);

// ⭐ PHASE 1: POST /api/workflows/:id/select - Activer un workflow
router.post('/:id/select',
    requireAuth,
    requireOwnershipAsync(async (req) => {
        const workflow = await Workflow.findById(req.params.id);
        return workflow ? workflow.userId.toString() : null;
    }),
    // ⭐ V4 FIX: Transactions retirées (MongoDB standalone)
    async (req, res) => {
        try {
            const user = req.user as IUser;
            const userId = user.id || user._id?.toString();
            const workflowId = req.params.id;

            const updatedWorkflow = await selectWorkflowUseCase.execute({
                workflowId,
                userId,
            });

            if (!updatedWorkflow) {
                return res.status(404).json({ error: 'Workflow introuvable' });
            }

            const workspaceSnapshot = await buildWorkspaceSnapshot({
                userId,
                workflow: updatedWorkflow,
                includeLegacyPrototypes: true
            });
            
            // ⭐ Production-safe: Only log in development
            if (process.env.NODE_ENV === 'development') {
              console.log('[Workflows] SELECT - Workflow activated:', {
                workflowId: workflowId,
                agentsCount: workspaceSnapshot.agentInstances.length
              });
            }
            
            res.json({
                success: true,
                workflow: updatedWorkflow,
                reloadedData: workspaceSnapshot
            });
            
        } catch (error) {
            if (error instanceof WorkflowValidationError) {
                return res.status(422).json({
                    error: 'Workflow IR invalide',
                    code: 'INVALID_WORKFLOW_IR',
                    issues: error.issues,
                });
            }

            console.error('[Workflows] SELECT error:', error);
            res.status(500).json({ 
                error: 'Erreur lors de l\'activation du workflow',
                details: error instanceof Error ? error.message : String(error)
            });
        }
    }
);

// ⭐ PHASE 1: GET /api/workflows/:id/stats - Obtenir les stats d'un workflow
router.get('/:id/stats',
    requireAuth,
    requireOwnershipAsync(async (req) => {
        const workflow = await Workflow.findById(req.params.id);
        return workflow ? workflow.userId.toString() : null;
    }),
    async (req, res) => {
        try {
            const workflow = await Workflow.findById(req.params.id);
            
            if (!workflow) {
                return res.status(404).json({ error: 'Workflow introuvable' });
            }
            
            // ⭐ PHASE 1: Count related entities (using top-level import)
            const [agentCount, nodeCount] = await Promise.all([
                AgentInstance.countDocuments({ workflowId: workflow._id }),
                WorkflowNodeV2.countDocuments({ workflowId: workflow._id })
            ]);
            
            res.json({
                _id: workflow._id,
                name: workflow.name,
                description: workflow.description,
                isActive: workflow.isActive,
                isDefault: workflow.isDefault,
                createdAt: workflow.createdAt,
                updatedAt: workflow.updatedAt,
                lastSavedAt: workflow.lastSavedAt,
                lastEditedBy: workflow.lastEditedBy,
                agentInstanceCount: agentCount,
                nodeCount: nodeCount
            });
        } catch (error) {
            console.error('[Workflows] STATS error:', error);
            res.status(500).json({ 
                error: 'Erreur lors de la récupération des stats',
                details: error instanceof Error ? error.message : String(error)
            });
        }
    }
);

// POST /api/workflows/:id/save - Sauvegarder état workflow (reset isDirty)
router.post('/:id/save',
    requireAuth,
    requireOwnershipAsync(async (req) => {
        const workflow = await Workflow.findById(req.params.id);
        return workflow ? workflow.userId.toString() : null;
    }),
    async (req, res) => {
        try {
            const user = req.user as IUser;
            const workflow = await saveWorkflowUseCase.execute({
                workflowId: req.params.id,
                userId: user.id,
            });

            if (!workflow) {
                return res.status(404).json({ error: 'Workflow introuvable' });
            }

            res.json({
                message: 'Workflow sauvegardé',
                lastSavedAt: workflow.lastSavedAt
            });
        } catch (error) {
            console.error('[Workflows] POST/:id/save error:', error);
            res.status(500).json({ error: 'Erreur sauvegarde workflow' });
        }
    }
);

/**
 * ⭐ ÉTAPE 4: PATCH /api/workflows/:id/patch - Mise à jour atomique partielle
 * 
 * RÈGLE 4.5.3 Dev_rules.md:
 * - N'envoie pas tout le workflow à chaque fois
 * - Utilise MongoDB $set pour updates ciblés
 * - Gère le versioning (__v) pour éviter "Lost Update"
 * 
 * Body: {
 *   $set: { field: value, ... },     // Partial updates
 *   expectedVersion?: number          // Optimistic locking
 * }
 */
router.patch('/:id/patch',
    requireAuth,
    requireOwnershipAsync(async (req) => {
        const workflow = await Workflow.findById(req.params.id);
        return workflow ? workflow.userId.toString() : null;
    }),
    async (req, res) => {
        try {
            const user = req.user as IUser;
            const { $set, expectedVersion } = req.body;

            if (!$set || typeof $set !== 'object') {
                return res.status(400).json({ 
                    error: 'Missing $set object in request body' 
                });
            }

            const result = await patchWorkflowUseCase.execute({
                workflowId: req.params.id,
                userId: user.id,
                setFields: $set,
                expectedVersion,
            });

            if (result.kind === 'not_found') {
                return res.status(404).json({ error: 'Workflow introuvable' });
            }

            if (result.kind === 'version_conflict') {
                return res.status(409).json({ 
                    error: 'Version conflict',
                    message: 'Document was modified by another request. Please refresh.',
                    currentVersion: result.currentVersion,
                    expectedVersion
                });
            }

            console.log('[Workflows] PATCH atomic update:', {
                id: req.params.id,
                fields: Object.keys($set),
                newVersion: result.workflow.__v
            });

            res.json({
                success: true,
                version: result.workflow.__v,
                updatedAt: result.workflow.updatedAt,
                lastSavedAt: result.workflow.lastSavedAt
            });

        } catch (error) {
            console.error('[Workflows] PATCH/:id/patch error:', error);
            res.status(500).json({ 
                error: 'Erreur mise à jour partielle workflow',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
);

/**
 * @deprecated V1 LEGACY — Ce endpoint opère sur Workflow.nodes[] qui n'existe pas dans le schéma.
 * Les positions sont gérées dans WorkflowNodeV2 (V2) ou AgentInstance.
 * TODO: Supprimer lors du cleanup V3.
 * 
 * ⭐ ÉTAPE 4: PATCH /api/workflows/:id/nodes/:nodeId/position
 */
router.patch('/:id/nodes/:nodeId/position',
    requireAuth,
    requireOwnershipAsync(async (req) => {
        const workflow = await Workflow.findById(req.params.id);
        return workflow ? workflow.userId.toString() : null;
    }),
    async (req, res) => {
        try {
            const user = req.user as IUser;
            const { x, y } = req.body;

            markLegacyWorkflowV1Usage(res, 'nodePositionPatch', req.params.id, req.params.nodeId);

            if (typeof x !== 'number' || typeof y !== 'number') {
                return res.status(400).json({ 
                    error: 'Invalid position: x and y must be numbers' 
                });
            }

            // Use positional operator to update specific node
            const result = await Workflow.findOneAndUpdate(
                { 
                    _id: req.params.id, 
                    userId: user.id,
                    'nodes.id': req.params.nodeId 
                },
                { 
                    $set: { 
                        'nodes.$.position': { x, y },
                        updatedAt: new Date()
                    }
                },
                { new: true }
            );

            if (!result) {
                return res.status(404).json({ 
                    error: 'Workflow or node not found' 
                });
            }

            res.json({ 
                success: true, 
                nodeId: req.params.nodeId,
                position: { x, y }
            });

        } catch (error) {
            console.error('[Workflows] PATCH node position error:', error);
            res.status(500).json({ error: 'Erreur mise à jour position' });
        }
    }
);

/**
 * @deprecated V1 LEGACY — Ce endpoint utilise $push sur Workflow.edges[] qui n'existe pas dans le schéma.
 * Les edges sont dans la collection WorkflowEdge (modèle séparé).
 * TODO: Supprimer lors du cleanup V3.
 *
 * ⭐ ÉTAPE 4: POST /api/workflows/:id/edges - Add edge with $push
 */
router.post('/:id/edges',
    requireAuth,
    requireOwnershipAsync(async (req) => {
        const workflow = await Workflow.findById(req.params.id);
        return workflow ? workflow.userId.toString() : null;
    }),
    async (req, res) => {
        try {
            const user = req.user as IUser;
            const { source, target, type = 'default', data } = req.body;

            markLegacyWorkflowV1Usage(res, 'edgeCreate', req.params.id);

            if (!source || !target) {
                return res.status(400).json({ 
                    error: 'source and target are required' 
                });
            }

            const edgeId = `edge_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const newEdge = {
                id: edgeId,
                source,
                target,
                type,
                data: data || {}
            };

            const result = await Workflow.findOneAndUpdate(
                { _id: req.params.id, userId: user.id },
                { 
                    $push: { edges: newEdge },
                    $set: { updatedAt: new Date() }
                },
                { new: true }
            );

            if (!result) {
                return res.status(404).json({ error: 'Workflow introuvable' });
            }

            res.status(201).json({ 
                success: true, 
                edge: newEdge 
            });

        } catch (error) {
            console.error('[Workflows] POST edge error:', error);
            res.status(500).json({ error: 'Erreur ajout edge' });
        }
    }
);

/**
 * @deprecated V1 LEGACY — Ce endpoint utilise $pull sur Workflow.edges[] qui n'existe pas dans le schéma.
 * TODO: Supprimer lors du cleanup V3.
 *
 * ⭐ ÉTAPE 4: DELETE /api/workflows/:id/edges/:edgeId - Remove edge with $pull
 */
router.delete('/:id/edges/:edgeId',
    requireAuth,
    requireOwnershipAsync(async (req) => {
        const workflow = await Workflow.findById(req.params.id);
        return workflow ? workflow.userId.toString() : null;
    }),
    async (req, res) => {
        try {
            const user = req.user as IUser;

            markLegacyWorkflowV1Usage(res, 'edgeDelete', req.params.id, req.params.edgeId);

            const result = await Workflow.findOneAndUpdate(
                { _id: req.params.id, userId: user.id },
                { 
                    $pull: { edges: { id: req.params.edgeId } },
                    $set: { updatedAt: new Date() }
                },
                { new: true }
            );

            if (!result) {
                return res.status(404).json({ error: 'Workflow introuvable' });
            }

            res.json({ 
                success: true, 
                deletedEdgeId: req.params.edgeId 
            });

        } catch (error) {
            console.error('[Workflows] DELETE edge error:', error);
            res.status(500).json({ error: 'Erreur suppression edge' });
        }
    }
);

// POST /api/workflows/:id/mark-dirty - Marquer workflow comme modifié
router.post('/:id/mark-dirty',
    requireAuth,
    requireOwnershipAsync(async (req) => {
        const workflow = await Workflow.findById(req.params.id);
        return workflow ? workflow.userId.toString() : null;
    }),
    async (req, res) => {
        try {
            const user = req.user as IUser;
            const workflow = await markWorkflowDirtyUseCase.execute({
                workflowId: req.params.id,
                userId: user.id,
            });

            if (!workflow) {
                return res.status(404).json({ error: 'Workflow introuvable' });
            }

            res.json({ message: 'Workflow marqué comme modifié' });
        } catch (error) {
            console.error('[Workflows] POST/:id/mark-dirty error:', error);
            res.status(500).json({ error: 'Erreur marquage workflow' });
        }
    }
);

// ============================================
// ⭐ ROUTES V2 - Nouvelle architecture de persistance
// ============================================
// Ces routes utilisent les modèles V2 (AgentInstanceV2, WorkflowNodeV2, AgentJournal)
// et implémentent le pattern Instance/Journal séparé.
// 
// Documentation: Guides/WIP/PERSISTANCES_ROUTES.md
// ============================================

/**
 * GET /api/workflows/:id/v2/graph
 * 
 * Version V2 du GET /:id - Retourne uniquement la structure légère du graphe.
 * Ne charge pas les données complètes des agents (lazy loading).
 * 
 * Response: {
 *   workflow: { _id, name, isDirty, canvasState, lastSavedAt },
 *   nodes: [{ id, type, position, data: { instanceId, ...uiConfig } }],
 *   edges: [{ id, source, target }]
 * }
 */
router.get('/:id/v2/graph',
    requireAuth,
    requireOwnershipAsync(async (req) => {
        const workflow = await Workflow.findById(req.params.id);
        return workflow ? workflow.userId.toString() : null;
    }),
    (req: Request, res: Response) => getWorkflowGraph(req as Request & { user: IUser }, res)
);

/**
 * POST /api/workflows/:id/v2/instances
 * 
 * Création atomique d'une instance d'agent ET de son nœud visuel.
 * Utilise une transaction MongoDB pour garantir la cohérence.
 * 
 * Body: {
 *   agentConfig: { name, role, prototypeId?, robotId, configuration },
 *   persistenceOptions: { saveChat, saveChatHistory, saveMedia, mediaStorage, saveHistorySummary, ... },
 *   position: { x, y }
 * }
 * 
 * Response: {
 *   instance: { _id, name, role, status, persistenceConfig },
 *   node: { _id, instanceId, position }
 * }
 */
router.post('/:id/v2/instances',
    requireAuth,
    requireOwnershipAsync(async (req) => {
        const workflow = await Workflow.findById(req.params.id);
        return workflow ? workflow.userId.toString() : null;
    }),
    (req: Request, res: Response) => createInstance(req as Request & { user: IUser }, res)
);

/**
 * DELETE /api/workflows/:id/v2/nodes/:nodeId
 * 
 * Suppression en cascade transactionnelle :
 * - WorkflowNodeV2
 * - AgentInstanceV2 (si type agent)
 * - AgentJournals liés
 * - WorkflowEdges connectés
 * - Fichiers média locaux
 * 
 * Response: {
 *   success: true,
 *   deletedNodeId, deletedInstanceId,
 *   deletedCounts: { journals, edges, mediaFiles }
 * }
 */
router.delete('/:id/v2/nodes/:nodeId',
    requireAuth,
    requireOwnershipAsync(async (req) => {
        const workflow = await Workflow.findById(req.params.id);
        return workflow ? workflow.userId.toString() : null;
    }),
    (req: Request, res: Response) => deleteNode(req as Request & { user: IUser }, res)
);

/**
 * PATCH /api/workflows/:id/v2/nodes/:nodeId
 * 
 * Mise à jour partielle d'un nœud V2 (position, uiConfig).
 * Optimisé pour les updates fréquents lors du drag sur le canvas.
 * 
 * Body: {
 *   position?: { x, y },
 *   uiConfig?: { label?, color?, expanded?, ... }
 * }
 * 
 * Response: { success: true, node }
 */
router.patch('/:id/v2/nodes/:nodeId',
    requireAuth,
    requireOwnershipAsync(async (req) => {
        const workflow = await Workflow.findById(req.params.id);
        return workflow ? workflow.userId.toString() : null;
    }),
    (req: Request, res: Response) => updateNode(req as Request & { user: IUser }, res)
);

export default router;

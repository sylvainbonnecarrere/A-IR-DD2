import { Router, Request, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Workflow } from '../models/Workflow.model';
import { AgentInstance } from '../models/AgentInstance.model';
import { WorkflowEdge } from '../models/WorkflowEdge.model';
import { requireAuth, requireOwnershipAsync } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import { IUser } from '../models/User.model';
import { WorkflowSelfHealingService } from '../services/workflowSelfHealing.service';

// ⭐ V2 IMPORTS - Nouvelle architecture de persistance (Jalon 1-2)
import {
    createInstance,
    deleteNode,
    getWorkflowGraph,
    updateNode
} from '../controllers/workflow.controller';

const router = Router();

// Schema validation
const createWorkflowSchema = z.object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional()
});

const updateWorkflowSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    isActive: z.boolean().optional()
});

// GET /api/workflows - Liste des workflows de l'utilisateur
router.get('/', requireAuth, async (req, res) => {
    try {
        const user = req.user as IUser;
        const workflows = await Workflow.find({ userId: user.id }).sort({ updatedAt: -1 });

        // Enrichir avec nombre d'agents par workflow
        const workflowsWithCounts = await Promise.all(
            workflows.map(async (workflow) => {
                const agentCount = await AgentInstance.countDocuments({ workflowId: workflow.id });
                return {
                    ...workflow.toObject(),
                    agentCount
                };
            })
        );

        res.json(workflowsWithCounts);
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
router.post('/', requireAuth, validateRequest(createWorkflowSchema), async (req, res) => {
    try {
        const user = req.user as IUser;
        console.log('[Workflows] POST - user:', { id: user.id, _id: user._id, email: user.email });

        // Si c'est le premier workflow, le marquer comme actif
        const existingCount = await Workflow.countDocuments({ userId: user.id });
        console.log('[Workflows] POST - existingCount:', existingCount);

        const workflow = new Workflow({
            userId: user.id,
            name: req.body.name,
            description: req.body.description,
            isActive: existingCount === 0,
            isDirty: false
        });
        console.log('[Workflows] POST - workflow before save:', workflow.toObject());

        await workflow.save();
        console.log('[Workflows] POST - workflow saved:', workflow._id);

        res.status(201).json(workflow);
    } catch (error) {
        console.error('[Workflows] POST error:', error);
        if (error instanceof Error) {
            console.error('[Workflows] POST error stack:', error.stack);
            console.error('[Workflows] POST error message:', error.message);
        }
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
            const workflow = await Workflow.findOne({ _id: req.params.id, userId: user.id });

            if (!workflow) {
                return res.status(404).json({ error: 'Workflow introuvable' });
            }

            // Si on active ce workflow, désactiver les autres
            if (req.body.isActive === true) {
                await Workflow.updateMany(
                    { userId: user.id, _id: { $ne: workflow.id } },
                    { isActive: false }
                );
            }

            Object.assign(workflow, req.body);
            workflow.lastSavedAt = new Date();
            workflow.isDirty = false;

            await workflow.save();

            res.json(workflow);
        } catch (error) {
            console.error('[Workflows] PUT error:', error);
            res.status(500).json({ error: 'Erreur mise à jour workflow' });
        }
    }
);

// DELETE /api/workflows/:id - Supprimer workflow (cascade)
router.delete('/:id',
    requireAuth,
    requireOwnershipAsync(async (req) => {
        const workflow = await Workflow.findById(req.params.id);
        return workflow ? workflow.userId.toString() : null;
    }),
    async (req, res) => {
        try {
            const user = req.user as IUser;
            const workflow = await Workflow.findOne({ _id: req.params.id, userId: user.id });

            if (!workflow) {
                return res.status(404).json({ error: 'Workflow introuvable' });
            }

            // Cascade delete: supprimer agents et edges
            const [agentsDeleted, edgesDeleted] = await Promise.all([
                AgentInstance.deleteMany({ workflowId: workflow.id }),
                WorkflowEdge.deleteMany({ workflowId: workflow.id })
            ]);

            await workflow.deleteOne();

            res.json({
                message: 'Workflow supprimé avec succès',
                agentsDeleted: agentsDeleted.deletedCount,
                edgesDeleted: edgesDeleted.deletedCount
            });
        } catch (error) {
            console.error('[Workflows] DELETE error:', error);
            res.status(500).json({ error: 'Erreur suppression workflow' });
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
            const workflow = await Workflow.findOne({ _id: req.params.id, userId: user.id });

            if (!workflow) {
                return res.status(404).json({ error: 'Workflow introuvable' });
            }

            workflow.lastSavedAt = new Date();
            workflow.isDirty = false;
            await workflow.save();

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

            // Build query with optional version check (optimistic locking)
            const query: any = { _id: req.params.id, userId: user.id };
            if (expectedVersion !== undefined) {
                query.__v = expectedVersion;
            }

            // Build update with $set + auto-update fields
            const update = {
                $set: {
                    ...$set,
                    updatedAt: new Date(),
                    isDirty: false,
                    lastSavedAt: new Date()
                },
                $inc: { __v: 1 } // Increment version for conflict detection
            };

            // Perform atomic update
            const result = await Workflow.findOneAndUpdate(
                query,
                update,
                { 
                    new: true,           // Return updated document
                    runValidators: true  // Run schema validators
                }
            );

            if (!result) {
                // Check if it's a version conflict or not found
                const exists = await Workflow.findOne({ 
                    _id: req.params.id, 
                    userId: user.id 
                });
                
                if (exists && expectedVersion !== undefined) {
                    return res.status(409).json({ 
                        error: 'Version conflict',
                        message: 'Document was modified by another request. Please refresh.',
                        currentVersion: exists.__v,
                        expectedVersion
                    });
                }
                
                return res.status(404).json({ error: 'Workflow introuvable' });
            }

            console.log('[Workflows] PATCH atomic update:', {
                id: req.params.id,
                fields: Object.keys($set),
                newVersion: result.__v
            });

            res.json({
                success: true,
                version: result.__v,
                updatedAt: result.updatedAt,
                lastSavedAt: result.lastSavedAt
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
 * ⭐ ÉTAPE 4: PATCH /api/workflows/:id/nodes/:nodeId/position
 * 
 * Optimized endpoint for node position updates only
 * Avoids sending full workflow on every drag
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
 * ⭐ ÉTAPE 4: POST /api/workflows/:id/edges - Add edge with $push
 * 
 * RÈGLE 4.5.3: Utilise $push pour ajout sans écraser le document
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
            const workflow = await Workflow.findOne({ _id: req.params.id, userId: user.id });

            if (!workflow) {
                return res.status(404).json({ error: 'Workflow introuvable' });
            }

            workflow.isDirty = true;
            await workflow.save();

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

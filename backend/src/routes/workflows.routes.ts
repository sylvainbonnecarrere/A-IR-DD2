import { Router, Request, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Workflow } from '../models/Workflow.model';
import { AgentInstance } from '../models/AgentInstance.model';
import { WorkflowEdge } from '../models/WorkflowEdge.model';
import { User, IUser } from '../models/User.model';
import { requireAuth, requireOwnershipAsync } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import { WorkflowSelfHealingService } from '../services/workflowSelfHealing.service';

// SOLID Architecture - Service Layer + Repository Pattern
import { WorkflowMigrationService } from '../services/WorkflowMigrationService';
import { UserRepository } from '../repositories/UserRepository';
import { WorkflowRepository } from '../repositories/WorkflowRepository';

// ⭐ V2 IMPORTS - Nouvelle architecture de persistance (Jalon 1-2)
import {
    createInstance,
    deleteNode,
    getWorkflowGraph,
    updateNode
} from '../controllers/workflow.controller';

const router = Router();

// ⭐ DEPENDENCY INJECTION - Instancer repositories et services
const userRepository = new UserRepository();
const workflowRepository = new WorkflowRepository();
const migrationService = new WorkflowMigrationService(userRepository, workflowRepository);

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

// GET /api/workflows - Liste des workflows + SYNCHRONOUS IDEMPOTENT MIGRATION
router.get('/', requireAuth, async (req, res) => {
    try {
        const user = req.user as IUser;
        const userId = user._id.toString();

        console.log(`[Workflows GET] User: ${userId}`);

        // ⭐ STEP 1: Get all workflows for user
        let workflows = await Workflow.find({ userId }).sort({ updatedAt: -1 });
        console.log(`[Workflows] Found ${workflows.length} workflows for user ${userId}`);

        // ⭐ STEP 2: SYNCHRONOUS MIGRATION - No async/await tricks
        if (workflows.length > 0) {
            // Workflows exist - ensure User has defaultWorkflowId SET
            const defaultWorkflow = workflows[0];
            const defaultWorkflowId = defaultWorkflow._id.toString();

            // Check if User needs update
            const currentDefaultId = user.defaultWorkflowId?.toString() || '';
            if (currentDefaultId !== defaultWorkflowId) {
                console.log(`[Workflows] Fixing User record: setting defaultWorkflowId to ${defaultWorkflowId}`);
                
                // ⭐ SYNCHRONOUS UPDATE - Wait for it to complete
                await User.findByIdAndUpdate(
                    userId,
                    {
                        defaultWorkflowId: new mongoose.Types.ObjectId(defaultWorkflowId),
                        workflowCount: workflows.length,
                        lastActiveWorkflowId: new mongoose.Types.ObjectId(defaultWorkflowId),
                        updatedAt: new Date()
                    },
                    { new: true }
                );
                console.log(`[Workflows] User record updated`);
            }
        } else {
            // No workflows - create default one SYNCHRONOUSLY
            console.log(`[Workflows] No workflows found, creating default`);
            
            const defaultWorkflow = new Workflow({
                userId: new mongoose.Types.ObjectId(userId),
                name: 'Mon Workflow',
                description: 'Workflow créé automatiquement pour débuter',
                isActive: true,
                isDefault: true
            });
            
            await defaultWorkflow.save();
            workflows = [defaultWorkflow];
            
            // Set as default for user
            await User.findByIdAndUpdate(
                userId,
                {
                    defaultWorkflowId: defaultWorkflow._id,
                    workflowCount: 1,
                    lastActiveWorkflowId: defaultWorkflow._id,
                    updatedAt: new Date()
                },
                { new: true }
            );
            console.log(`[Workflows] Created default workflow and updated User record`);
        }

        // ⭐ STEP 3: Return workflows with agent counts
        const workflowsWithCounts = await Promise.all(
            workflows.map(async (workflow) => {
                const agentCount = await AgentInstance.countDocuments({ workflowId: workflow.id });
                return {
                    ...workflow.toObject(),
                    agentCount
                };
            })
        );

        console.log(`[Workflows] Returning ${workflowsWithCounts.length} workflows`);
        res.json({ workflows: workflowsWithCounts });
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
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const user = req.user as IUser;
        const userId = user._id.toString();

        console.log(`[Workflows POST] Creating workflow for user: ${userId}`);

        // ⭐ Use repository to count existing workflows (SOLID)
        const existingCount = await Workflow.countDocuments({ userId }).session(session);
        const isFirstWorkflow = existingCount === 0;

        // ⭐ Create workflow via repository
        const newWorkflow = new Workflow({
            userId,
            name: req.body.name,
            description: req.body.description,
            isActive: isFirstWorkflow,
            isDefault: isFirstWorkflow,
            isDirty: false,
            canvasState: {
                zoom: 1,
                panX: 0,
                panY: 0
            }
        });

        await newWorkflow.save({ session });
        console.log(`[Workflows POST] Created workflow: ${newWorkflow._id}`);

        // ⭐ Sync User record - if first workflow, set as default
        if (isFirstWorkflow) {
            await User.findByIdAndUpdate(
                userId,
                {
                    $set: {
                        defaultWorkflowId: newWorkflow._id,
                        workflowCount: 1,
                        lastActiveWorkflowId: newWorkflow._id
                    }
                },
                { session, new: true }
            );
            console.log(`[Workflows POST] First workflow - User updated with defaultWorkflowId`);
        } else {
            // Just increment count
            await User.findByIdAndUpdate(
                userId,
                { $inc: { workflowCount: 1 } },
                { session }
            );
        }

        await session.commitTransaction();
        res.status(201).json(newWorkflow);
        
    } catch (error) {
        await session.abortTransaction();
        console.error('[Workflows POST] Error:', error);
        res.status(500).json({ error: 'Erreur création workflow', details: error instanceof Error ? error.message : String(error) });
    } finally {
        await session.endSession();
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

// DELETE /api/workflows/:id - Supprimer workflow (cascade atomique)
router.delete('/:id',
    requireAuth,
    requireOwnershipAsync(async (req) => {
        const workflow = await Workflow.findById(req.params.id);
        return workflow ? workflow.userId.toString() : null;
    }),
    async (req, res) => {
        const session = await mongoose.startSession();
        session.startTransaction();
        
        try {
            const user = req.user as IUser;
            
            // ⭐ PHASE 1: Fetch workflow within transaction
            const workflow = await Workflow.findOne({ 
                _id: req.params.id, 
                userId: user.id 
            }).session(session);

            if (!workflow) {
                await session.abortTransaction();
                return res.status(404).json({ error: 'Workflow introuvable' });
            }

            // ⭐ PHASE 1: Check if this is the last workflow
            const otherWorkflowCount = await Workflow.countDocuments({
                userId: user.id,
                _id: { $ne: workflow.id }
            }).session(session);

            if (otherWorkflowCount === 0) {
                await session.abortTransaction();
                return res.status(400).json({
                    error: 'Impossible de supprimer le seul workflow',
                    code: 'LAST_WORKFLOW',
                    message: 'Chaque utilisateur doit avoir au moins un workflow'
                });
            }

            // ⭐ PHASE 1: ATOMIC CASCADE DELETE
            const WorkflowNodeV2 = require('../models/WorkflowNodeV2.model').WorkflowNodeV2;
            const AgentJournal = require('../models/AgentJournal.model').AgentJournal;
            
            const deletionResults = await Promise.all([
                // Delete related data
                AgentInstance.deleteMany({ workflowId: workflow.id }, { session }),
                WorkflowEdge.deleteMany({ workflowId: workflow.id }, { session }),
                WorkflowNodeV2.deleteMany({ workflowId: workflow.id }, { session }),
                AgentJournal.deleteMany({ workflowId: workflow.id }, { session }),
                // Delete workflow itself
                Workflow.deleteOne({ _id: workflow.id }, { session })
            ]);

            // ⭐ PHASE 1: If this was defaultWorkflowId, reassign to another
            const { User } = require('../models/User.model');
            const userDoc = await User.findById(user.id).session(session);
            
            if (userDoc?.defaultWorkflowId?.equals(workflow.id)) {
                // Find next oldest workflow to assign as default
                const nextWorkflow = await Workflow
                    .findOne({ userId: user.id })
                    .sort({ createdAt: 1 })
                    .session(session);

                if (nextWorkflow) {
                    // ⭐ PHASE 1: Update defaultWorkflowId AND mark as default
                    await Workflow.updateOne(
                        { _id: nextWorkflow.id },
                        { isDefault: true },
                        { session }
                    );
                    
                    await User.findByIdAndUpdate(
                        user.id,
                        {
                            defaultWorkflowId: nextWorkflow._id,
                            $inc: { workflowCount: -1 }
                        },
                        { session, new: true }
                    );
                    
                    console.log('[Workflows] DELETE - Reassigned defaultWorkflowId:', {
                        userId: user.id,
                        deletedWorkflowId: workflow.id,
                        newDefaultWorkflowId: nextWorkflow.id
                    });
                }
            } else {
                // Just decrement workflowCount
                await User.findByIdAndUpdate(
                    user.id,
                    { $inc: { workflowCount: -1 } },
                    { session }
                );
            }

            await session.commitTransaction();

            res.json({
                success: true,
                message: 'Workflow supprimé avec succès',
                deletedWorkflowId: workflow.id,
                cascade: {
                    agentsDeleted: deletionResults[0].deletedCount,
                    edgesDeleted: deletionResults[1].deletedCount,
                    nodesDeleted: deletionResults[2].deletedCount,
                    journalsDeleted: deletionResults[3].deletedCount
                }
            });
        } catch (error) {
            await session.abortTransaction();
            console.error('[Workflows] DELETE error:', error);
            res.status(500).json({ 
                error: 'Erreur suppression workflow',
                details: error instanceof Error ? error.message : String(error)
            });
        } finally {
            await session.endSession();
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
    async (req, res) => {
        const session = await mongoose.startSession();
        session.startTransaction();
        
        try {
            const user = req.user as IUser;
            const workflowId = req.params.id;
            
            // Validate workflow exists and belongs to user
            const workflow = await Workflow.findOne({
                _id: workflowId,
                userId: user.id
            }).session(session);
            
            if (!workflow) {
                await session.abortTransaction();
                return res.status(404).json({ error: 'Workflow introuvable' });
            }
            
            // ⭐ PHASE 1: Update all workflows atomically
            // Disable others, enable this one
            await Workflow.updateMany(
                { userId: user.id, _id: { $ne: workflowId } },
                { isActive: false },
                { session }
            );
            
            await Workflow.updateOne(
                { _id: workflowId },
                { 
                    isActive: true,
                    lastSavedAt: new Date()
                },
                { session }
            );
            
            // ⭐ PHASE 1: Update User lastActiveWorkflowId
            const { User } = require('../models/User.model');
            await User.findByIdAndUpdate(
                user.id,
                { lastActiveWorkflowId: workflow._id },
                { session }
            );
            
            // ⭐ PHASE 1: Fetch related data for this workflow
            const WorkflowNodeV2 = require('../models/WorkflowNodeV2.model').WorkflowNodeV2;
            const [agents, nodes, edges] = await Promise.all([
                AgentInstance.find({ workflowId }).session(session),
                WorkflowNodeV2.find({ workflowId }).session(session),
                WorkflowEdge.find({ workflowId }).session(session)
            ]);
            
            await session.commitTransaction();
            
            const updatedWorkflow = await Workflow.findById(workflowId);
            
            console.log('[Workflows] SELECT - Workflow activated:', {
                userId: user.id,
                workflowId: workflowId,
                agentsCount: agents?.length || 0,
                nodesCount: nodes?.length || 0
            });
            
            res.json({
                success: true,
                workflow: updatedWorkflow,
                reloadedData: {
                    agents: agents || [],
                    nodes: nodes || [],
                    edges: edges || [],
                    canvasState: workflow.canvasState
                }
            });
            
        } catch (error) {
            await session.abortTransaction();
            console.error('[Workflows] SELECT error:', error);
            res.status(500).json({ 
                error: 'Erreur lors de l\'activation du workflow',
                details: error instanceof Error ? error.message : String(error)
            });
        } finally {
            await session.endSession();
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
            
            // ⭐ PHASE 1: Count related entities
            const WorkflowNodeV2 = require('../models/WorkflowNodeV2.model').WorkflowNodeV2;
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

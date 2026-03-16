/**
 * @file user-workspace.routes.ts
 * @description Composite endpoint for user workspace hydration (J4.4)
 * @domain Design Domain - Workspace Persistence & Hydration
 * 
 * ARCHITECTURE:
 * - Single endpoint to fetch entire user workspace state
 * - Eliminates waterfall API calls on frontend
 * - Supports hydration after F5 refresh
 * 
 * ENDPOINTS:
 * - GET /api/user/workspace - Full workspace state (workflow, agents, configs)
 * - GET /api/user/workspace/default - Get or create default workflow
 * 
 * SECURITY:
 * - Requires Bearer token (JWT)
 * - All resources filtered by userId
 * - API keys NEVER exposed in response
 * 
 * SOLID PRINCIPLES:
 * - S: Single responsibility (workspace aggregation only)
 * - O: Open for extension (add new domains easily)
 * - L: Liskov substitution (standard REST interface)
 * - I: Interface segregation (minimal response per use-case)
 * - D: Dependency inversion (uses models via interfaces)
 */

import { Router, Request, Response } from 'express';
import { Workflow } from '../models/Workflow.model';
import { AgentPrototype } from '../models/AgentPrototype.model';
import { requireAuth } from '../middleware/auth.middleware';
import { IUser } from '../models/User.model';
import { WorkflowSelfHealingService } from '../services/workflowSelfHealing.service';
import { buildWorkspaceSnapshot } from '../utils/workspaceSnapshot';

const router = Router();

/**
 * GET /api/user/workspace
 * Fetch complete workspace state for hydration
 * 
 * Use cases:
 * - App mount (initial load)
 * - Page refresh (F5)
 * - Login success → hydrate user data
 * 
 * Response: WorkspaceResponse
 */
router.get('/workspace', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = req.user as IUser;
        const userId = user.id || user._id;

        // ⭐ SELF-HEALING: Garantir qu'un workflow par défaut existe
        const { workflow: defaultWorkflow, wasCreated, healingActions } = 
            await WorkflowSelfHealingService.ensureDefaultWorkflow(userId.toString());
        
        // Production-safe logging: only log healing events (important for debugging)
        if (wasCreated && process.env.NODE_ENV === 'development') {
            console.log('[Workspace] Self-healing triggered:', healingActions);
        }

        const agentPrototypes = await AgentPrototype.find({
            userId,
            $or: [
                { workflowId: defaultWorkflow?._id },
                { workflowId: { $exists: false } },
                { workflowId: null }
            ]
        }).sort({ name: 1 });

        // ⭐ V2 SELF-HEALING: Assign orphaned prototypes (no workflowId) to default workflow
        if (defaultWorkflow) {
            const orphanedPrototypes = agentPrototypes.filter(
                (p: any) => !p.workflowId
            );
            if (orphanedPrototypes.length > 0) {
                await AgentPrototype.updateMany(
                    { userId, $or: [{ workflowId: { $exists: false } }, { workflowId: null }] },
                    { workflowId: defaultWorkflow._id }
                );
                console.log(`[Workspace] Self-healing: Assigned ${orphanedPrototypes.length} orphaned prototypes to workflow ${defaultWorkflow._id}`);
            }
        }

        const response = await buildWorkspaceSnapshot({
            userId: userId.toString(),
            workflow: defaultWorkflow,
            wasCreated,
            healingActions,
            includeLegacyPrototypes: true
        });

        console.log('[Workspace] GET - response summary:', {
            hasWorkflow: !!defaultWorkflow,
            workflowId: defaultWorkflow?.id,
            workflowWasCreated: wasCreated,
            nodesCount: response.nodes.length,
            edgesCount: response.edges.length,
            llmConfigsCount: response.llmConfigs.length
        });

        res.json(response);

    } catch (error) {
        console.error('[Workspace] GET error:', error);
        res.status(500).json({
            error: 'Failed to fetch workspace',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * GET /api/user/workspace/default
 * Get or create default workflow for user
 * 
 * Use cases:
 * - New user first login (create default workspace)
 * - User deleted all workflows (recreate default)
 * 
 * Response: { workflow: IWorkflow, isNewlyCreated: boolean }
 */
router.get('/workspace/default', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = req.user as IUser;
        const userId = user.id || user._id;

        // ⭐ ÉTAPE 1.6: Chercher d'abord le workflow par défaut (isDefault: true)
        let workflow = await Workflow.findOne({ userId, isDefault: true });

        if (!workflow) {
            // Fallback: Check for active workflow
            workflow = await Workflow.findOne({ userId, isActive: true });
        }

        if (!workflow) {
            // Check for any workflow
            workflow = await Workflow.findOne({ userId }).sort({ updatedAt: -1 });
        }

        let isNewlyCreated = false;

        if (!workflow) {
            // Create default workflow for new user
            // ⭐ ÉTAPE 1.6: Inclure isDefault et canvasState
            workflow = new Workflow({
                userId,
                name: 'Mon Workflow',
                description: 'Workflow par défaut',
                isActive: true,
                isDefault: true, // ⭐ NOUVEAU
                isDirty: false,
                canvasState: { // ⭐ NOUVEAU
                    zoom: 1,
                    panX: 0,
                    panY: 0
                }
            });
            await workflow.save();
            isNewlyCreated = true;

            console.log('[Workspace] Created default workflow for user:', userId);
        }

        res.json({
            workflow: {
                id: workflow.id,
                name: workflow.name,
                description: workflow.description,
                isActive: workflow.isActive,
                isDefault: (workflow as any).isDefault || false, // ⭐ NOUVEAU
                isDirty: workflow.isDirty,
                canvasState: (workflow as any).canvasState || { zoom: 1, panX: 0, panY: 0 }, // ⭐ NOUVEAU
                createdAt: workflow.createdAt,
                updatedAt: workflow.updatedAt
            },
            isNewlyCreated
        });

    } catch (error) {
        console.error('[Workspace] GET default error:', error);
        res.status(500).json({
            error: 'Failed to get default workspace',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

export default router;

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
import { AgentInstance } from '../models/AgentInstance.model';
import { AgentPrototype } from '../models/AgentPrototype.model';
import { WorkflowEdge } from '../models/WorkflowEdge.model';
import { LLMConfig } from '../models/LLMConfig.model';
import UserSettings from '../models/UserSettings.model';
import { requireAuth } from '../middleware/auth.middleware';
import { IUser } from '../models/User.model';
import { WorkflowSelfHealingService } from '../services/workflowSelfHealing.service';

const router = Router();

/**
 * Response interface for workspace endpoint
 * Defines contract between backend and frontend hydration
 * 
 * ⭐ UPDATED ÉTAPE 1.6: Added canvasState, isDefault, content support
 */
interface WorkspaceResponse {
    workflow: {
        id: string;
        name: string;
        description?: string;
        isActive: boolean;
        isDefault: boolean; // ⭐ NOUVEAU ÉTAPE 1.6
        isDirty: boolean;
        canvasState: { // ⭐ NOUVEAU ÉTAPE 1.6
            zoom: number;
            panX: number;
            panY: number;
        };
        createdAt: Date;
        updatedAt: Date;
        lastSavedAt?: Date;
    } | null;
    nodes: Array<{
        id: string;
        agentId: string;
        agentName: string;
        position: { x: number; y: number };
        provider: string;
        model: string;
        createdAt: Date;
    }>;
    edges: Array<{
        id: string;
        sourceId: string;
        targetId: string;
        type: string;
    }>;
    agentInstances: Array<{
        id: string;
        name: string;
        provider: string;
        model: string;
        position: { x: number; y: number };
        systemInstruction?: string;
        // ⭐ NOUVEAU ÉTAPE 1.6: Ajout des propriétés polymorphes
        executionId?: string;
        status?: string;
        content?: Array<{
            type: 'chat' | 'image' | 'video' | 'error';
            [key: string]: any;
        }>;
        metrics?: {
            totalTokens: number;
            totalErrors: number;
            totalMediaGenerated: number;
            callCount: number;
        };
        createdAt: Date;
    }>;
    agentPrototypes: Array<{
        id: string;
        name: string;
        provider: string;
        model: string;
        description?: string;
    }>;
    llmConfigs: Array<{
        id: string;
        provider: string;
        enabled: boolean;
        hasApiKey: boolean;
        capabilities: Record<string, boolean>;
        updatedAt: Date;
    }>;
    userSettings: {
        language: string;
        theme: string;
    };
    metadata: {
        loadedAt: Date;
        userId: string;
        hasWorkflow: boolean;
        workflowWasCreated?: boolean;  // ⭐ SELF-HEALING indicator
        healingActions?: string[];      // ⭐ SELF-HEALING actions taken
    };
}

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

        // Parallel fetch all user resources for performance
        const [
            agentPrototypes,
            llmConfigs,
            userSettings
        ] = await Promise.all([
            // ⭐ V2: Get agent prototypes scoped to default workflow
            // Include legacy prototypes (no workflowId) for self-healing migration
            AgentPrototype.find({
                userId,
                $or: [
                    { workflowId: defaultWorkflow?._id },
                    { workflowId: { $exists: false } },
                    { workflowId: null }
                ]
            }).sort({ name: 1 }),
            // Get all LLM configs (without API keys)
            LLMConfig.find({ userId }),
            // Get user settings
            UserSettings.findOne({ userId })
        ]);

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

        // Le workflow par défaut est garanti par Self-Healing
        const workflow = defaultWorkflow;

        // Fetch workflow-specific data if workflow exists
        let agentInstances: any[] = [];
        let edges: any[] = [];

        if (workflow) {
            [agentInstances, edges] = await Promise.all([
                AgentInstance.find({ workflowId: workflow.id }),
                WorkflowEdge.find({ workflowId: workflow.id })
            ]);
        }

        // Build response (SECURITY: never expose apiKeyEncrypted)
        const response: WorkspaceResponse = {
            workflow: workflow ? {
                id: workflow.id,
                name: workflow.name,
                description: workflow.description,
                isActive: workflow.isActive,
                isDefault: (workflow as any).isDefault || false, // ⭐ NOUVEAU ÉTAPE 1.6
                isDirty: workflow.isDirty,
                // ⭐ NOUVEAU ÉTAPE 1.6: Canvas state pour reconstruction visuelle
                canvasState: (workflow as any).canvasState || {
                    zoom: 1,
                    panX: 0,
                    panY: 0
                },
                createdAt: workflow.createdAt,
                updatedAt: workflow.updatedAt,
                lastSavedAt: workflow.lastSavedAt
            } : null,

            nodes: agentInstances.map(agent => ({
                id: agent._id?.toString() || agent.id,
                agentId: agent._id?.toString() || agent.id,
                agentName: agent.name,
                position: agent.position || { x: 0, y: 0 },
                provider: agent.llmProvider || agent.provider,
                model: agent.llmModel || agent.model,
                createdAt: agent.createdAt
            })),

            edges: edges.map(edge => ({
                id: edge.id,
                sourceId: edge.sourceNodeId || edge.sourceId,
                targetId: edge.targetNodeId || edge.targetId,
                type: edge.type || 'default'
            })),

        // ⭐ ÉTAPE 1.6: Ajout des propriétés polymorphes (content, metrics, status)
            agentInstances: agentInstances.map(agent => {
                // ⭐ CRITICAL: Reconstruct configuration_json like transformAgentInstanceForFrontend
                // This ensures consistency across all API endpoints (agent-instances, user-workspace, etc.)
                return {
                    id: agent._id?.toString() || agent.id,
                    name: agent.name,
                    provider: agent.llmProvider,
                    model: agent.llmModel,
                    position: agent.position || { x: 0, y: 0 },
                    systemInstruction: agent.systemPrompt,
                    executionId: agent.executionId,
                    status: agent.status,
                    content: agent.content || [],
                    metrics: agent.metrics || {
                        totalTokens: 0,
                        totalErrors: 0,
                        totalMediaGenerated: 0,
                        callCount: 0
                    },
                    prototypeId: agent.prototypeId?.toString() || agent.prototypeId,
                    workflowId: agent.workflowId?.toString() || agent.workflowId,
                    createdAt: agent.createdAt,
                    // ⭐ TOP-LEVEL fields (for backward compatibility with some code)
                    role: agent.role,
                    llmProvider: agent.llmProvider,
                    llmModel: agent.llmModel,
                    systemPrompt: agent.systemPrompt,
                    capabilities: agent.capabilities || [],
                    tools: agent.tools || [],
                    historyConfig: agent.historyConfig || {},
                    outputConfig: agent.outputConfig || {},
                    robotId: agent.robotId,
                    isMinimized: agent.isMinimized || false,
                    isMaximized: agent.isMaximized || false,
                    // ⭐ CRITICAL: Include configuration_json reconstructed from individual fields
                    // This matches what transformAgentInstanceForFrontend returns
                    // useWorkspaceHydration will use this directly, not reconstruct it
                    configuration_json: {
                        role: agent.role || 'assistant',
                        model: agent.llmModel || 'gpt-4o-mini',
                        llmProvider: agent.llmProvider || 'openai',
                        systemPrompt: agent.systemPrompt || '',
                        capabilities: Array.isArray(agent.capabilities) ? agent.capabilities : [],
                        tools: Array.isArray(agent.tools) ? agent.tools : [],
                        historyConfig: agent.historyConfig || {},
                        outputConfig: agent.outputConfig || {},
                        position: agent.position || { x: 0, y: 0 }
                    }
                };
            }),

            agentPrototypes: agentPrototypes.map(proto => ({
                id: proto.id,
                name: proto.name,
                provider: proto.llmProvider,
                model: proto.llmModel,
                description: proto.role, // Use role as description for prototypes
                // ⭐ BUG FIX #1.5: Include configuration fields (were omitted from prototypes too)
                role: proto.role,
                capabilities: proto.capabilities || [],
                tools: proto.tools || [],
                historyConfig: proto.historyConfig,
                outputConfig: proto.outputConfig,
                robotId: proto.robotId
            })),

            // SECURITY: Only expose hasApiKey boolean, never the encrypted key
            llmConfigs: llmConfigs.map(config => ({
                id: config.id,
                provider: config.provider,
                enabled: config.enabled,
                hasApiKey: !!config.apiKeyEncrypted,
                capabilities: config.capabilities || {},
                updatedAt: config.updatedAt
            })),

            userSettings: {
                language: userSettings?.preferences?.language || 'fr',
                theme: userSettings?.preferences?.theme || 'dark'
            },

            metadata: {
                loadedAt: new Date(),
                userId: userId.toString(),
                hasWorkflow: !!workflow,
                workflowWasCreated: wasCreated,  // ⭐ SELF-HEALING indicator
                healingActions: healingActions.length > 0 ? healingActions : undefined
            }
        };

        console.log('[Workspace] GET - response summary:', {
            hasWorkflow: !!workflow,
            workflowId: workflow?.id,
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

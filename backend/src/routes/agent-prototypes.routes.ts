import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { AgentPrototype } from '../models/AgentPrototype.model';
import { requireAuth, requireOwnershipAsync } from '../middleware/auth.middleware';
import { requireRobotGovernance } from '../middleware/robot-governance.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import { IUser } from '../models/User.model';
import { CanonicalRobotIdEnum } from '../types/robotIds';
import { WebSearchParamsSchema, parseWebSearchParams } from '../schemas/web-search-params.schema';
import { extractPersistenceConfigValue, normalizePersistenceConfigForPersistence, normalizePersistenceConfigForProduct } from '../types/persistence';

const router = Router();

const toolSelectionSchema = z.object({
    toolId: z.string(),
    versionRef: z.object({
        versionTag: z.string().optional(),
        versionNumber: z.number().optional(),
        workspaceId: z.string().nullable().optional()
    }).optional()
});

const persistenceConfigSchema = z.object({
    saveChat: z.boolean().optional(),
    saveChatHistory: z.boolean().optional(),
    saveErrors: z.boolean().optional(),
    saveHistorySummary: z.boolean().optional(),
    saveTasks: z.boolean().optional(),
    saveTaskExecution: z.boolean().optional(),
    saveLinks: z.boolean().optional(),
    saveMedia: z.boolean().optional(),
    allowWorkspaceWrite: z.boolean().optional(),
    mediaStorage: z.enum(['db', 'local', 'workspace', 'cloud']).optional(),
    cloudConnectionProfileId: z.string().optional(),
    retentionDays: z.number().int().positive().optional(),
}).strict().optional();

function buildPrototypeResponse(prototype: any): Record<string, any> {
    const responseObj: Record<string, any> = prototype.toObject();
    responseObj.functionIds = (prototype.tools || []).map((id: any) => id.toString());
    responseObj.toolSelections = prototype.toolSelections || responseObj.functionIds.map((toolId: string) => ({ toolId }));
    responseObj.tools = Array.isArray(prototype.legacyTools) ? prototype.legacyTools : [];
    const rawPersistenceConfig = extractPersistenceConfigValue(prototype.persistenceConfig);
    responseObj.persistenceConfig = normalizePersistenceConfigForProduct(rawPersistenceConfig);

    return responseObj;
}

// Schema validation
// ⭐ J4.5: Robot IDs must match frontend RobotId enum in types.ts
// ⭐ J4.5: Allow empty strings for role/systemPrompt to match frontend flexibility
const createAgentPrototypeSchema = z.object({
    name: z.string().min(1).max(100),
    role: z.string().max(200).default(''),
    systemPrompt: z.string().default(''),
    llmProvider: z.string(),
    llmModel: z.string(),
    capabilities: z.array(z.string()).default([]),
    historyConfig: z.object({}).passthrough().optional(),
    webSearchParams: WebSearchParamsSchema.optional(),
    tools: z.array(z.object({}).passthrough()).optional(),       // legacy (rétrocompat)
    functionIds: z.array(z.string()).optional(),                 // V2 — ids stables de tools, alias frontend vers user_tools
    toolSelections: z.array(toolSelectionSchema).optional(),     // V2 cible — refs versionnées
    outputConfig: z.object({}).passthrough().optional(),
    persistenceConfig: persistenceConfigSchema,
    robotId: CanonicalRobotIdEnum,
    workflowId: z.string().optional(), // ⭐ V2: Optional workflow scope
    localLLMProfileId: z.string().optional() // ⭐ NEW: Optional local LLM profile reference
});

const updateAgentPrototypeSchema = createAgentPrototypeSchema.partial();

// ⭐ SECURITY: Query parameter validation schemas
const queryParamsSchema = z.object({
    robotId: CanonicalRobotIdEnum.optional(),
    workflowId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid ObjectId format').optional()
});

// GET /api/agent-prototypes - Liste des prototypes (filtrés par workflow si workflowId fourni)
router.get('/', requireAuth, async (req, res) => {
    try {
        const user = req.user as IUser;
        
        // ⭐ SECURITY: Validate and sanitize query params
        const queryValidation = queryParamsSchema.safeParse(req.query);
        if (!queryValidation.success) {
            return res.status(400).json({ error: 'Invalid query parameters', details: queryValidation.error.issues });
        }
        
        const { robotId, workflowId } = queryValidation.data;

        const query: { userId: string; robotId?: string; workflowId?: string } = { userId: user.id };
        if (robotId) {
            query.robotId = robotId;
        }
        // ⭐ V2: Filter by workflowId if provided
        if (workflowId) {
            query.workflowId = workflowId;
        }

        const prototypes = await AgentPrototype.find(query).sort({ createdAt: -1 });
        res.json(prototypes.map(buildPrototypeResponse));
    } catch (error) {
        console.error('[AgentPrototypes] GET error:', error);
        res.status(500).json({ error: 'Erreur récupération prototypes' });
    }
});

// GET /api/agent-prototypes/:id - Prototype spécifique
router.get('/:id',
    requireAuth,
    requireOwnershipAsync(async (req) => {
        const prototype = await AgentPrototype.findById(req.params.id);
        return prototype ? prototype.userId.toString() : null;
    }),
    async (req, res) => {
        try {
            const prototype = await AgentPrototype.findById(req.params.id);

            if (!prototype) {
                return res.status(404).json({ error: 'Prototype introuvable' });
            }

            res.json(buildPrototypeResponse(prototype));
        } catch (error) {
            console.error('[AgentPrototypes] GET/:id error:', error);
            res.status(500).json({ error: 'Erreur récupération prototype' });
        }
    }
);

// POST /api/agent-prototypes - Créer prototype (gouvernance minimale : ownership-based)
router.post('/',
    requireAuth,
    validateRequest(createAgentPrototypeSchema),
    requireRobotGovernance({
        governedType: 'agent',
        operation: 'create',
        resolveTargetRobotId: (req) => req.body?.robotId
    }),
    async (req, res) => {
        try {
            const user = req.user as IUser;

            // C3 FIX: Extraire functionIds et mapper vers tools (ObjectId[])
            const { functionIds, toolSelections, tools, webSearchParams, persistenceConfig, ...rest } = req.body;
            const prototypeData: Record<string, any> = { userId: user.id, ...rest };
            if (webSearchParams !== undefined) {
                prototypeData.webSearchParams = parseWebSearchParams(webSearchParams);
            }
            if (persistenceConfig !== undefined) {
                prototypeData.persistenceConfig = normalizePersistenceConfigForPersistence(persistenceConfig);
            }
            const canonicalFunctionIds = Array.isArray(functionIds) && functionIds.length > 0
                ? functionIds
                : Array.isArray(toolSelections)
                    ? toolSelections.map((selection: { toolId: string }) => selection.toolId).filter(Boolean)
                    : [];

            // V2: functionIds transporte des ids stables de tools compatibles legacy/cible
            if (canonicalFunctionIds.length > 0) {
                prototypeData.tools = canonicalFunctionIds.map((id: string) => new mongoose.Types.ObjectId(id));
                prototypeData.toolSelections = Array.isArray(toolSelections) && toolSelections.length > 0
                    ? toolSelections
                    : canonicalFunctionIds.map((toolId: string) => ({ toolId }));
            } else if (!functionIds && !toolSelections && tools && Array.isArray(tools)) {
                // Rétrocompat: si tools contient des objets legacy (non-ObjectId), les mettre en legacyTools
                prototypeData.legacyTools = tools;
            }

            const prototype = new AgentPrototype(prototypeData);

            await prototype.save();

            // C3 FIX: Retourner functionIds dans la réponse pour le mapping frontend
            res.status(201).json(buildPrototypeResponse(prototype));
        } catch (error) {
            console.error('[AgentPrototypes] POST error:', error);
            if (error instanceof z.ZodError) {
                return res.status(400).json({
                    error: 'Validation échouée',
                    details: error.errors.map((e) => ({
                        field: e.path.join('.'),
                        message: e.message,
                        code: e.code,
                    })),
                });
            }
            res.status(500).json({ error: 'Erreur création prototype' });
        }
    }
);

// PUT /api/agent-prototypes/:id - Mettre à jour prototype
router.put('/:id',
    requireAuth,
    requireOwnershipAsync(async (req) => {
        const prototype = await AgentPrototype.findById(req.params.id);
        return prototype ? prototype.userId.toString() : null;
    }),
    validateRequest(updateAgentPrototypeSchema),
    requireRobotGovernance({
        governedType: 'agent',
        operation: 'modify',
        resolveTargetRobotId: async (req) => {
            if (typeof req.body?.robotId === 'string') {
                return req.body.robotId;
            }

            const prototype = await AgentPrototype.findById(req.params.id).select('robotId');
            return prototype?.robotId;
        }
    }),
    async (req, res) => {
        try {
            const user = req.user as IUser;
            const prototype = await AgentPrototype.findOne({ _id: req.params.id, userId: user.id });

            if (!prototype) {
                return res.status(404).json({ error: 'Prototype introuvable' });
            }

            // ⭐ SECURITY FIX: Whitelist allowed fields to prevent mass assignment
            const { name, role, systemPrompt, llmProvider, llmModel, capabilities, historyConfig, webSearchParams, tools, functionIds, toolSelections, outputConfig, persistenceConfig, robotId, workflowId, localLLMProfileId } = req.body;

            // Update only whitelisted fields (userId never modifiable)
            if (name !== undefined) prototype.name = name;
            if (role !== undefined) prototype.role = role;
            if (systemPrompt !== undefined) prototype.systemPrompt = systemPrompt;
            if (llmProvider !== undefined) prototype.llmProvider = llmProvider;
            if (llmModel !== undefined) prototype.llmModel = llmModel;
            if (capabilities !== undefined) prototype.capabilities = capabilities;
            if (historyConfig !== undefined) prototype.historyConfig = historyConfig;
            if (webSearchParams !== undefined) prototype.webSearchParams = parseWebSearchParams(webSearchParams);
            // C3 FIX: functionIds (V2) prend la priorité sur tools (legacy) et reste l'alias frontend canonique
            if (functionIds !== undefined || toolSelections !== undefined) {
                const canonicalFunctionIds = Array.isArray(functionIds)
                    ? functionIds
                    : Array.isArray(toolSelections)
                        ? toolSelections.map((selection: { toolId: string }) => selection.toolId).filter(Boolean)
                        : [];

                prototype.tools = canonicalFunctionIds.map((id: string) => new mongoose.Types.ObjectId(id));
                prototype.toolSelections = Array.isArray(toolSelections)
                    ? toolSelections
                    : canonicalFunctionIds.map((toolId: string) => ({ toolId }));
            } else if (tools !== undefined) {
                // Rétrocompat: stocker en legacyTools si ce sont des objets (pas des ObjectId strings)
                prototype.legacyTools = tools;
            }
            if (outputConfig !== undefined) prototype.outputConfig = outputConfig;
            if (persistenceConfig !== undefined) prototype.persistenceConfig = normalizePersistenceConfigForPersistence(persistenceConfig);
            if (robotId !== undefined) prototype.robotId = robotId;
            if (workflowId !== undefined) prototype.workflowId = workflowId;
            if (localLLMProfileId !== undefined) prototype.localLLMProfileId = localLLMProfileId;

            await prototype.save();

            // C3 FIX: Retourner functionIds dans la réponse pour le mapping frontend
            res.json(buildPrototypeResponse(prototype));
        } catch (error) {
            console.error('[AgentPrototypes] PUT error:', error);
            if (error instanceof z.ZodError) {
                return res.status(400).json({
                    error: 'Validation échouée',
                    details: error.errors.map((e) => ({
                        field: e.path.join('.'),
                        message: e.message,
                        code: e.code,
                    })),
                });
            }
            res.status(500).json({ error: 'Erreur mise à jour prototype' });
        }
    }
);

// DELETE /api/agent-prototypes/:id - Supprimer prototype
// Note: Les AgentInstances gardent leur snapshot, pas de cascade delete
router.delete('/:id',
    requireAuth,
    requireOwnershipAsync(async (req) => {
        const prototype = await AgentPrototype.findById(req.params.id);
        return prototype ? prototype.userId.toString() : null;
    }),
    requireRobotGovernance({
        governedType: 'agent',
        operation: 'delete',
        resolveTargetRobotId: async (req) => {
            const prototype = await AgentPrototype.findById(req.params.id).select('robotId');
            return prototype?.robotId;
        }
    }),
    async (req, res) => {
        try {
            const user = req.user as IUser;
            const prototype = await AgentPrototype.findOne({ _id: req.params.id, userId: user.id });

            if (!prototype) {
                return res.status(404).json({ error: 'Prototype introuvable' });
            }

            await prototype.deleteOne();

            res.json({ message: 'Prototype supprimé' });
        } catch (error) {
            console.error('[AgentPrototypes] DELETE error:', error);
            res.status(500).json({ error: 'Erreur suppression prototype' });
        }
    }
);

export default router;

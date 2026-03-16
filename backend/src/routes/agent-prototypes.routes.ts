import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { AgentPrototype } from '../models/AgentPrototype.model';
import { requireAuth, requireOwnershipAsync } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import { IUser } from '../models/User.model';
import { CanonicalRobotIdEnum } from '../types/robotIds';

const router = Router();

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
    tools: z.array(z.object({}).passthrough()).optional(),       // legacy (rétrocompat)
    functionIds: z.array(z.string()).optional(),                 // V2 — références ObjectId UserFunction
    outputConfig: z.object({}).passthrough().optional(),
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
        res.json(prototypes);
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

            res.json(prototype);
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
    async (req, res) => {
        try {
            const user = req.user as IUser;

            // C3 FIX: Extraire functionIds et mapper vers tools (ObjectId[])
            const { functionIds, tools, ...rest } = req.body;
            const prototypeData: Record<string, any> = { userId: user.id, ...rest };

            // V2: fonctions sélectionnées via FunctionSelector → ObjectId refs
            if (functionIds && functionIds.length > 0) {
                prototypeData.tools = functionIds.map((id: string) => new mongoose.Types.ObjectId(id));
            } else if (!functionIds && tools && Array.isArray(tools)) {
                // Rétrocompat: si tools contient des objets legacy (non-ObjectId), les mettre en legacyTools
                prototypeData.legacyTools = tools;
            }

            const prototype = new AgentPrototype(prototypeData);

            await prototype.save();

            // C3 FIX: Retourner functionIds dans la réponse pour le mapping frontend
            const responseObj: Record<string, any> = prototype.toObject();
            responseObj.functionIds = (prototype.tools || []).map((id: any) => id.toString());

            res.status(201).json(responseObj);
        } catch (error) {
            console.error('[AgentPrototypes] POST error:', error);
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
    async (req, res) => {
        try {
            const user = req.user as IUser;
            const prototype = await AgentPrototype.findOne({ _id: req.params.id, userId: user.id });

            if (!prototype) {
                return res.status(404).json({ error: 'Prototype introuvable' });
            }

            // ⭐ SECURITY FIX: Whitelist allowed fields to prevent mass assignment
            const { name, role, systemPrompt, llmProvider, llmModel, capabilities, historyConfig, tools, functionIds, outputConfig, robotId, workflowId, localLLMProfileId } = req.body;

            // Update only whitelisted fields (userId never modifiable)
            if (name !== undefined) prototype.name = name;
            if (role !== undefined) prototype.role = role;
            if (systemPrompt !== undefined) prototype.systemPrompt = systemPrompt;
            if (llmProvider !== undefined) prototype.llmProvider = llmProvider;
            if (llmModel !== undefined) prototype.llmModel = llmModel;
            if (capabilities !== undefined) prototype.capabilities = capabilities;
            if (historyConfig !== undefined) prototype.historyConfig = historyConfig;
            // C3 FIX: functionIds (V2) prend la priorité sur tools (legacy)
            if (functionIds !== undefined) {
                prototype.tools = functionIds.map((id: string) => new mongoose.Types.ObjectId(id));
            } else if (tools !== undefined) {
                // Rétrocompat: stocker en legacyTools si ce sont des objets (pas des ObjectId strings)
                prototype.legacyTools = tools;
            }
            if (outputConfig !== undefined) prototype.outputConfig = outputConfig;
            if (robotId !== undefined) prototype.robotId = robotId;
            if (workflowId !== undefined) prototype.workflowId = workflowId;
            if (localLLMProfileId !== undefined) prototype.localLLMProfileId = localLLMProfileId;

            await prototype.save();

            // C3 FIX: Retourner functionIds dans la réponse pour le mapping frontend
            const responseObj: Record<string, any> = prototype.toObject();
            responseObj.functionIds = (prototype.tools || []).map((id: any) => id.toString());

            res.json(responseObj);
        } catch (error) {
            console.error('[AgentPrototypes] PUT error:', error);
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

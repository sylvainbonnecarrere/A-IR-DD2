import { Router } from 'express';
import { z } from 'zod';
import { AgentPrototype } from '../models/AgentPrototype.model';
import { requireAuth, requireOwnershipAsync } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import { IUser } from '../models/User.model';

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
    tools: z.array(z.object({}).passthrough()).optional(),
    outputConfig: z.object({}).passthrough().optional(),
    robotId: z.enum(['AR_001', 'BO_002', 'CO_003', 'PH_004', 'TI_005']),
    workflowId: z.string().optional(), // ⭐ V2: Optional workflow scope
    localLLMProfileId: z.string().optional() // ⭐ NEW: Optional local LLM profile reference
});

const updateAgentPrototypeSchema = createAgentPrototypeSchema.partial();

// ⭐ SECURITY: Query parameter validation schemas
const queryParamsSchema = z.object({
    robotId: z.enum(['AR_001', 'BO_002', 'CO_003', 'PH_004', 'TI_005']).optional(),
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

            const prototype = new AgentPrototype({
                userId: user.id,
                ...req.body
            });

            await prototype.save();

            res.status(201).json(prototype);
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
            const { name, role, systemPrompt, llmProvider, llmModel, capabilities, historyConfig, tools, outputConfig, robotId, workflowId, localLLMProfileId } = req.body;

            // Update only whitelisted fields (userId never modifiable)
            if (name !== undefined) prototype.name = name;
            if (role !== undefined) prototype.role = role;
            if (systemPrompt !== undefined) prototype.systemPrompt = systemPrompt;
            if (llmProvider !== undefined) prototype.llmProvider = llmProvider;
            if (llmModel !== undefined) prototype.llmModel = llmModel;
            if (capabilities !== undefined) prototype.capabilities = capabilities;
            if (historyConfig !== undefined) prototype.historyConfig = historyConfig;
            if (tools !== undefined) prototype.tools = tools;
            if (outputConfig !== undefined) prototype.outputConfig = outputConfig;
            if (robotId !== undefined) prototype.robotId = robotId;
            if (workflowId !== undefined) prototype.workflowId = workflowId;
            if (localLLMProfileId !== undefined) prototype.localLLMProfileId = localLLMProfileId;

            await prototype.save();

            res.json(prototype);
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

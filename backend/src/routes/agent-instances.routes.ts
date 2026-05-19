import { Router, Request, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { AgentInstance } from '../models/AgentInstance.model';
import { AgentJournal } from '../models/AgentJournal.model';
import { AgentPrototype } from '../models/AgentPrototype.model';
import { UserToolRun } from '../models/UserToolRun.model';
import { Workflow } from '../models/Workflow.model';
import { requireAuth, requireOwnershipAsync } from '../middleware/auth.middleware';
import { requireRobotGovernance } from '../middleware/robot-governance.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import { IUser } from '../models/User.model';
import { journalService } from '../services/journal.service';
import { buildChatMessagesByInstance } from '../utils/chatMessageProjection';
import { transformAgentInstanceForFrontend } from '../utils/transforms';
import { CanonicalRobotIdEnum } from '../types/robotIds';
import { WebSearchParamsSchema, parseWebSearchParams } from '../schemas/web-search-params.schema';
import { extractPersistenceConfigValue, normalizePersistenceConfigForPersistence, normalizePersistenceConfigForProduct, summarizePersistenceConfigBoundary } from '../types/persistence';
import { AgentInstanceDeletionPolicyService } from '../services/agentInstanceDeletionPolicy.service';

// Type pour les paramètres de route hérités (via mergeParams)
interface WorkflowParams {
    workflowId: string;
    id?: string;
}

// CORRECTION SOLID: mergeParams: true pour hériter des paramètres du parent (:workflowId)
const router = Router({ mergeParams: true });

const toolSelectionSchema = z.object({
    toolId: z.string(),
    versionRef: z.object({
        versionTag: z.string().optional(),
        versionNumber: z.number().optional(),
        workspaceId: z.string().nullable().optional()
    }).optional()
});

function normalizeIncomingPersistenceConfig<T extends { persistenceConfig?: any }>(payload: T): T {
    if (!payload?.persistenceConfig) {
        return payload;
    }

    return {
        ...payload,
        persistenceConfig: normalizePersistenceConfigForPersistence(payload.persistenceConfig)
    };
}

// Schema validation
const createAgentInstanceSchema = z.object({
    workflowId: z.string(),
    prototypeId: z.string().optional(),

    // Snapshot config
    name: z.string().min(1).max(100),
    role: z.string().min(1).max(200),
    systemPrompt: z.string().min(1),
    llmProvider: z.string(),
    llmModel: z.string(),
    capabilities: z.array(z.string()).default([]),
    historyConfig: z.object({}).passthrough().optional(),
    tools: z.array(z.object({}).passthrough()).optional(),
    toolSelections: z.array(toolSelectionSchema).optional(),
    webSearchParams: WebSearchParamsSchema.optional(),
    outputConfig: z.object({}).passthrough().optional(),
    robotId: CanonicalRobotIdEnum,
    
    // ⭐ FIX QA: Add persistenceConfig to validation schema for media storage
    persistenceConfig: z.object({
        saveChat: z.boolean().optional(),
        saveChatHistory: z.boolean().optional(),
        saveErrors: z.boolean().optional(),
        saveHistorySummary: z.boolean().optional(),
        saveLinks: z.boolean().optional(),
        saveTasks: z.boolean().optional(),
        saveTaskExecution: z.boolean().optional(),
        saveMedia: z.boolean().optional(),
        allowWorkspaceWrite: z.boolean().optional(),
        mediaStorage: z.enum(['db', 'local', 'workspace', 'cloud']).optional(),
        cloudConnectionProfileId: z.string().optional(),
        retentionDays: z.number().int().positive().optional()
    }).strict().optional(),

    // Canvas properties
    position: z.object({
        x: z.number(),
        y: z.number()
    }),
    isMinimized: z.boolean().default(false),
    isMaximized: z.boolean().default(false),
    zIndex: z.number().default(0),

    // ⭐ J6: functionInheritance — héritage des fonctions depuis le prototype
    functionInheritance: z.object({
        inheritFromPrototype: z.boolean(),
        overrideFunctionIds: z.array(z.string()).optional(),
        overrideToolSelections: z.array(toolSelectionSchema).optional()
    }).optional()
});

const updateAgentInstanceSchema = createAgentInstanceSchema.partial();

const deleteAgentInstanceQuerySchema = z.object({
    mediaPolicy: z.enum(['delete_media', 'orphan_media']).optional().default('delete_media')
});

const importedMediaDraftSchema = z.object({
    attachmentId: z.string().min(1).max(160),
    fileName: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(255),
    contentBase64: z.string().min(1),
    origin: z.string().min(1).max(64).optional(),
});

function buildDraftImportMessageId(origin: string | undefined, attachmentId: string): string {
    const originSlug = (origin || 'unknown')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'unknown';

    const attachmentSlug = attachmentId
        .trim()
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'draft';

    return `draft-import::${originSlug}::${attachmentSlug}`;
}

// GET /api/workflows/:workflowId/instances - Liste des instances
router.get('/', requireAuth, async (req: Request<WorkflowParams>, res: Response) => {
    try {
        const user = req.user as IUser;
        const { workflowId } = req.params;

        if (!workflowId || !mongoose.Types.ObjectId.isValid(workflowId)) {
            return res.status(400).json({ error: 'workflowId invalide' });
        }

        // Vérifier que workflow appartient à user
        const workflow = await Workflow.findOne({ _id: workflowId, userId: user.id });
        if (!workflow) {
            return res.status(404).json({ error: 'Workflow introuvable' });
        }

        const instances = await AgentInstance.find({ workflowId });
        // ⭐ FIX: Transform all instances for frontend consumption
        res.json(instances.map(transformAgentInstanceForFrontend));
    } catch (error) {
        console.error('[AgentInstances] GET error:', error);
        res.status(500).json({ error: 'Erreur récupération instances' });
    }
});

// GET /api/agent-instances/:id - Instance spécifique
router.get('/:id',
    requireAuth,
    requireOwnershipAsync(async (req) => {
        const instance = await AgentInstance.findById(req.params.id);
        return instance ? instance.userId.toString() : null;
    }),
    async (req, res) => {
        try {
            const user = req.user as IUser;
            const instance = await AgentInstance.findById(req.params.id);

            if (!instance) {
                return res.status(404).json({ error: 'Instance introuvable' });
            }

            const [journalEntries, toolRuns] = await Promise.all([
                AgentJournal.find({
                    agentInstanceId: instance._id,
                    type: { $in: ['chat', 'tool_invocation'] }
                }).sort({ timestamp: 1 }),
                UserToolRun.find({
                    ownerUserId: user.id,
                    agentInstanceId: instance._id
                }).sort({ createdAt: -1 }).limit(200)
            ]);

            const transformedInstance = transformAgentInstanceForFrontend(instance);
            const chatMessagesByInstance = buildChatMessagesByInstance(
                journalEntries,
                new Map(toolRuns.map((run: any) => [run.executionId, run]))
            );

            res.json({
                ...transformedInstance,
                chatMessages: chatMessagesByInstance[transformedInstance.id] || []
            });
        } catch (error) {
            console.error('[AgentInstances] GET/:id error:', error);
            res.status(500).json({ error: 'Erreur récupération instance' });
        }
    }
);

// POST /api/workflows/:workflowId/instances - Créer instance sur workflow
router.post('/',
    requireAuth,
    validateRequest(createAgentInstanceSchema),
    requireRobotGovernance({
        governedType: 'agent',
        operation: 'create',
        resolveTargetRobotId: (req) => req.body?.robotId
    }),
    async (req, res) => {
        try {
            const user = req.user as IUser;
            const { workflowId } = req.params;
            const { prototypeId, ...instanceData } = req.body;
            
            if (!workflowId || !mongoose.Types.ObjectId.isValid(workflowId)) {
                return res.status(400).json({ error: 'workflowId invalide' });
            }

            // Vérifier que workflow appartient à user
            const workflow = await Workflow.findOne({ _id: workflowId, userId: user.id });
            if (!workflow) {
                return res.status(404).json({ error: 'Workflow introuvable' });
            }

            // Si prototypeId fourni, vérifier qu'il appartient à user
            if (prototypeId) {
                const prototype = await AgentPrototype.findOne({ _id: prototypeId, userId: user.id });
                if (!prototype) {
                    return res.status(404).json({ error: 'Prototype introuvable' });
                }
            }

            const normalizedInstanceData = instanceData.webSearchParams !== undefined
                ? { ...instanceData, webSearchParams: parseWebSearchParams(instanceData.webSearchParams) }
                : instanceData;

            const instance = new AgentInstance({
                workflowId,
                userId: user.id,
                prototypeId: prototypeId || undefined,
                ...normalizedInstanceData
            });

            await instance.save();

            // Marquer workflow comme dirty
            workflow.isDirty = true;
            await workflow.save();

            res.status(201).json(transformAgentInstanceForFrontend(instance));
        } catch (error) {
            console.error('[AgentInstances] POST error:', error);
            res.status(500).json({ error: 'Erreur création instance' });
        }
    }
);

// POST /api/workflows/:workflowId/instances/from-prototype - Créer instance depuis prototype
// ⭐ MERGE STRATEGY: prototype (source) + body overrides (name, persistenceConfig)
router.post('/from-prototype', requireAuth,
    requireRobotGovernance({
        governedType: 'agent',
        operation: 'create',
        resolveTargetRobotId: async (req) => {
            const user = req.user as IUser | undefined;
            const prototypeId = req.body?.prototypeId;

            if (!user?.id || typeof prototypeId !== 'string' || !mongoose.Types.ObjectId.isValid(prototypeId)) {
                return undefined;
            }

            const prototype = await AgentPrototype.findOne({ _id: prototypeId, userId: user.id }).select('robotId');
            return prototype?.robotId;
        }
    }),
    async (req, res) => {
    try {
        const user = req.user as IUser;
        const { workflowId } = req.params;
        const { prototypeId, position, name, persistenceConfig, configuration_json } = req.body;

        if (!workflowId || !mongoose.Types.ObjectId.isValid(workflowId)) {
            return res.status(400).json({ error: 'workflowId invalide' });
        }
        
        if (!prototypeId || !position) {
            return res.status(400).json({
                error: 'prototypeId et position requis'
            });
        }

        // Vérifier ownership prototype
        const prototype = await AgentPrototype.findOne({ _id: prototypeId, userId: user.id });
        if (!prototype) {
            return res.status(404).json({ error: 'Prototype introuvable' });
        }

        // Vérifier ownership workflow
        const workflow = await Workflow.findOne({ _id: workflowId, userId: user.id });
        if (!workflow) {
            return res.status(404).json({ error: 'Workflow introuvable' });
        }

        // ⭐ GÉNÉRER executionId unique (UUID format)
        const executionId = `run-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

        // ⭐ MERGE STRATEGY: configuration_json (from frontend) + prototype (fallback)
        // Frontend sends configuration_json with capabilities + historyConfig explicitly
        // This ensures template capabilities are persisted to the instance
        
        // 1. Name: utiliser override si fourni, sinon prototype.name, sinon fallback
        const finalName = name?.trim() || prototype.name || 'Agent sans nom';
        
        // 2. Champs requis avec fallbacks robustes (évite ValidationError)
        // PHASE 2: Prioritize configuration_json if provided (from frontend form)
        const finalRole = configuration_json?.role?.trim() || prototype.role?.trim() || 'Assistant généraliste';
        const finalSystemPrompt = configuration_json?.systemPrompt?.trim() || prototype.systemPrompt?.trim() || 'Tu es un assistant IA utile et professionnel.';
        const finalLlmProvider = configuration_json?.llmProvider || prototype.llmProvider || 'openai';
        const finalLlmModel = configuration_json?.model || prototype.llmModel || 'gpt-4o-mini';
        const finalRobotId = prototype.robotId || 'AR_001';
        
        // 3. Tableaux: PHASE 2 - Use frontend capabilities if provided, else prototype
        // Chat is ALWAYS included (minimum capability)
        const frontendCapabilities = configuration_json?.capabilities || [];
        const prototypeCapabilities = Array.isArray(prototype.capabilities) ? prototype.capabilities : [];
        const capabilitiesToUse = frontendCapabilities.length > 0 ? frontendCapabilities : prototypeCapabilities;
        
        // Ensure Chat is always present
        const finalCapabilities = Array.isArray(capabilitiesToUse) 
          ? Array.from(new Set(['Chat', ...capabilitiesToUse]))  // Dedupe and ensure Chat
          : ['Chat'];
        
        const finalTools = Array.isArray(prototype.tools) ? prototype.tools : [];
        const finalLegacyTools = Array.isArray(configuration_json?.tools)
            ? configuration_json.tools
            : (Array.isArray((prototype as any).legacyTools) ? (prototype as any).legacyTools : []);
        const finalToolSelections = Array.isArray((prototype as any).toolSelections) && (prototype as any).toolSelections.length > 0
            ? (prototype as any).toolSelections
            : finalTools.map((toolId: mongoose.Types.ObjectId) => ({ toolId: toolId.toString() }));
        
        // 4. PHASE 2 - HistoryConfig: Use frontend config if provided
        const finalHistoryConfig = configuration_json?.historyConfig || prototype.historyConfig || {};
        const finalOutputConfig = configuration_json?.outputConfig || prototype.outputConfig || {};
            const finalWebSearchParams = configuration_json?.webSearchParams !== undefined
                ? parseWebSearchParams(configuration_json.webSearchParams)
                : (prototype as any).webSearchParams || undefined;
        // ⭐ LOCAL LLM: Resolve localLLMProfileId (frontend takes precedence over prototype)
        const finalLocalLLMProfileId = configuration_json?.localLLMProfileId ?? (prototype as any).localLLMProfileId ?? null;
        
        // 5. PersistenceConfig: merge prototype config avec overrides
        const prototypePersistenceConfig = normalizePersistenceConfigForPersistence(
            extractPersistenceConfigValue(prototype.persistenceConfig) ?? {
                saveChat: true,
                saveErrors: true,
                saveHistorySummary: false,
                saveLinks: false,
                saveTasks: false,
                allowWorkspaceWrite: true,
                mediaStorage: 'db'
            }
        );
        
        const normalizedRequestPersistence = normalizeIncomingPersistenceConfig({ persistenceConfig }).persistenceConfig;
        const finalPersistenceConfig = normalizedRequestPersistence
            ? { ...prototypePersistenceConfig, ...normalizedRequestPersistence }
            : prototypePersistenceConfig;

        // Log des valeurs finales pour debugging
        console.log('[AgentInstances] 📋 Instance data prepared (PHASE 2):', {
            name: finalName,
            role: finalRole,
            llmProvider: finalLlmProvider,
            llmModel: finalLlmModel,
            robotId: finalRobotId,
            hasTools: finalTools.length,
            capabilities: finalCapabilities,
            hasHistoryConfig: Object.keys(finalHistoryConfig).length > 0
        });

        // Créer instance avec snapshot du prototype + overrides frontend + fallbacks
        const instance = new AgentInstance({
            workflowId,
            userId: user.id,
            prototypeId: prototype.id,

            // ⭐ executionId unique (required)
            executionId,
            status: 'running',

            // Snapshot config avec overrides frontend
            name: finalName,
            role: finalRole,
            systemPrompt: finalSystemPrompt,
            llmProvider: finalLlmProvider,
            llmModel: finalLlmModel,
            capabilities: finalCapabilities,  // ⭐ PHASE 2: From frontend configuration_json
            historyConfig: finalHistoryConfig,  // ⭐ PHASE 2: From frontend configuration_json
            outputConfig: finalOutputConfig,  // ⭐ PHASE 2: From frontend configuration_json
            webSearchParams: finalWebSearchParams,
            tools: finalTools,
            legacyTools: finalLegacyTools,
            toolSelections: finalToolSelections,
            robotId: finalRobotId,
            // ⭐ LOCAL LLM: Persist localLLMProfileId for correct endpoint resolution
            localLLMProfileId: finalLocalLLMProfileId,

            // Canvas properties
            position,
            isMinimized: false,
            isMaximized: false,
            zIndex: 0,

            // persistenceConfig avec overrides
            persistenceConfig: finalPersistenceConfig,

            // ⭐ J6: functionInheritance — hériter les fonctions du prototype par défaut
            functionInheritance: {
                inheritFromPrototype: true,
                overrideFunctionIds: [],
                overrideToolSelections: []
            },

            // initialisation contenu et métriques
            content: [],
            metrics: {
                totalTokens: 0,
                totalErrors: 0,
                totalMediaGenerated: 0,
                callCount: 0
            },
            startedAt: new Date()
        });

        await instance.save();

        // Marquer workflow comme dirty
        workflow.isDirty = true;
        await workflow.save();

        console.log('[AgentInstances] ✅ Instance créée depuis prototype (PHASE 2):', {
            instanceId: instance._id,
            executionId,
            prototypeId: prototype.id,
            name: finalName,
            capabilitiesCount: finalCapabilities.length
        });

        // ⭐ FIX: Map MongoDB _id → id for frontend compatibility
        // AND reconstruct configuration_json from individual fields
        // Use the helper function to ensure consistency across all endpoints
        const mappedInstance = transformAgentInstanceForFrontend(instance);

        res.status(201).json(mappedInstance);
    } catch (error: any) {
        // ⭐ LOGGING AMÉLIORÉ: afficher les détails de l'erreur de validation
        console.error('[AgentInstances] ❌ POST/from-prototype error:', {
            message: error.message,
            name: error.name,
            // Si c'est une ValidationError Mongoose, afficher les champs en erreur
            validationErrors: error.errors 
                ? Object.keys(error.errors).map(key => ({
                    field: key,
                    message: error.errors[key].message,
                    value: error.errors[key].value
                }))
                : undefined,
            stack: error.stack?.split('\n').slice(0, 5).join('\n')
        });
        
        // Réponse avec plus de détails (en dev uniquement)
        const errorResponse: any = { 
            error: 'Erreur création instance depuis prototype',
            message: error.message
        };
        
        // Ajouter les détails de validation si disponibles
        if (error.name === 'ValidationError' && error.errors) {
            errorResponse.validationErrors = Object.keys(error.errors).map(key => ({
                field: key,
                message: error.errors[key].message
            }));
        }
        
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

        res.status(500).json(errorResponse);
    }
});

// PUT /api/agent-instances/:id - Mettre à jour instance
router.put('/:id',
    requireAuth,
    requireOwnershipAsync(async (req) => {
        const instance = await AgentInstance.findById(req.params.id);
        return instance ? instance.userId.toString() : null;
    }),
    validateRequest(updateAgentInstanceSchema),
    requireRobotGovernance({
        governedType: 'agent',
        operation: 'modify',
        resolveTargetRobotId: async (req) => {
            if (typeof req.body?.robotId === 'string') {
                return req.body.robotId;
            }

            const instance = await AgentInstance.findById(req.params.id).select('robotId');
            return instance?.robotId;
        }
    }),
    async (req, res) => {
        try {
            const user = req.user as IUser;
            const instanceId = req.params.id;
            
            console.log('[AgentInstances] 🔧 PUT /:id called:', {
                instanceId,
                userId: user.id,
                bodyKeys: Object.keys(req.body),
                hasConfigurationJson: !!req.body.configuration_json,
                hasPersistenceConfig: !!req.body.persistenceConfig,
                persistenceConfig: summarizePersistenceConfigBoundary(req.body.persistenceConfig)
            });
            
            const instance = await AgentInstance.findOne({ _id: instanceId, userId: user.id });

            if (!instance) {
                console.log('[AgentInstances] ❌ Instance not found or user mismatch:', {
                    instanceId,
                    instanceFound: !!instance
                });
                return res.status(404).json({ error: 'Instance introuvable' });
            }

            // Empêcher modification workflowId, userId
            delete req.body.workflowId;
            delete req.body.userId;

            // ⭐ FIX #1.1: Destructure configuration_json to individual fields
            // Frontend sends configuration_json object, but schema has individual fields
            const { configuration_json, ...otherUpdates } = req.body;
            
            if (configuration_json) {
                // Mapping: configuration_json properties → schema fields
                // MANDATORY: These come directly from frontend configuration
                if (configuration_json.role !== undefined) {
                    instance.role = configuration_json.role;
                }
                if (configuration_json.systemPrompt !== undefined) {
                    instance.systemPrompt = configuration_json.systemPrompt;
                }
                if (configuration_json.llmProvider !== undefined) {
                    instance.llmProvider = configuration_json.llmProvider;
                }
                if (configuration_json.model !== undefined) {
                    instance.llmModel = configuration_json.model; // Note: frontend sends 'model', schema uses 'llmModel'
                }
                
                // ARRAYS: Capabilities
                if (Array.isArray(configuration_json.capabilities)) {
                    instance.capabilities = configuration_json.capabilities;
                }
                if (Array.isArray(configuration_json.toolSelections)) {
                    instance.toolSelections = configuration_json.toolSelections;
                }
                if (Array.isArray(configuration_json.tools)) {
                    instance.legacyTools = configuration_json.tools;
                } else if (Array.isArray(configuration_json.legacyTools)) {
                    instance.legacyTools = configuration_json.legacyTools;
                }
                // ⭐ ARCHITECTURE NOTE — dual storage:
                //   instance.tools (ObjectId[]) = stable tool IDs mirrored across legacy/cible
                //   functionInheritance.overrideFunctionIds (String[]) = instance-level override IDs in the same ID space
                //   These serve DIFFERENT purposes and are NOT the same field.
                //
                //   DO NOT overwrite instance.tools from configuration_json.tools here because:
                //   - configuration_json.tools may contain legacy Tool objects (schema: {name, description, parameters})
                //     which are NOT valid ObjectId refs and would corrupt the V2 function registry links.
                //   - The canonical way to override functions for an instance is via functionInheritance below.
                //
                //   instance.tools is updated only via functionInheritance.overrideFunctionIds sync (see below).
                if (Array.isArray(configuration_json.legacyTools)) {
                    instance.legacyTools = configuration_json.legacyTools;
                }
                
                // OBJECTS: HistoryConfig + OutputConfig
                if (configuration_json.historyConfig !== undefined) {
                    instance.historyConfig = configuration_json.historyConfig;
                }
                if (configuration_json.outputConfig !== undefined) {
                    instance.outputConfig = configuration_json.outputConfig;
                }
                if (configuration_json.webSearchParams !== undefined) {
                    instance.webSearchParams = parseWebSearchParams(configuration_json.webSearchParams);
                }
                // J6: Function Inheritance
                if (configuration_json.functionInheritance !== undefined) {
                    instance.functionInheritance = configuration_json.functionInheritance;
                    const overrideToolSelections = Array.isArray(configuration_json.functionInheritance.overrideToolSelections)
                        ? configuration_json.functionInheritance.overrideToolSelections
                        : Array.isArray(configuration_json.functionInheritance.overrideFunctionIds)
                            ? configuration_json.functionInheritance.overrideFunctionIds.map((toolId: string) => ({ toolId }))
                            : [];
                    // ⭐ SYNC: When override mode is active, also update instance.tools with ObjectId refs
                    // so the V2 function registry is consistent for runtime execution.
                    if (
                        configuration_json.functionInheritance.inheritFromPrototype === false &&
                        Array.isArray(configuration_json.functionInheritance.overrideFunctionIds)
                    ) {
                        instance.tools = configuration_json.functionInheritance.overrideFunctionIds
                            .filter((id: string) => mongoose.Types.ObjectId.isValid(id))
                            .map((id: string) => new mongoose.Types.ObjectId(id));
                        instance.toolSelections = overrideToolSelections;
                    } else if (configuration_json.functionInheritance.inheritFromPrototype !== false) {
                        const prototype = instance.prototypeId
                            ? await AgentPrototype.findOne({ _id: instance.prototypeId, userId: user.id }).select('tools toolSelections')
                            : null;
                        const inheritedToolIds = Array.isArray(prototype?.tools) ? prototype.tools : [];
                        instance.tools = inheritedToolIds;
                        instance.toolSelections = Array.isArray((prototype as any)?.toolSelections) && (prototype as any).toolSelections.length > 0
                            ? (prototype as any).toolSelections
                            : inheritedToolIds.map((toolId: mongoose.Types.ObjectId) => ({ toolId: toolId.toString() }));
                    }
                }
                // ⭐ LOCAL LLM: Persist localLLMProfileId (which local LLM profile to use)
                if (configuration_json.localLLMProfileId !== undefined) {
                    instance.localLLMProfileId = configuration_json.localLLMProfileId;
                }
                
                // PRESERVE RUNTIME DATA: Never overwrite logs, errors, tasks, links from frontend
                // These should only be updated by auto-save endpoints
                // Skip: configuration_json.logs, errors, tasks, links (backend-only)
            }
            
            // Apply other updates (name, position, etc.) using Object.assign
            const normalizedPayload = normalizeIncomingPersistenceConfig(otherUpdates);
            const normalizedOtherUpdates = normalizedPayload.webSearchParams !== undefined
                ? { ...normalizedPayload, webSearchParams: parseWebSearchParams(normalizedPayload.webSearchParams) }
                : normalizedPayload;

            Object.assign(instance, normalizedOtherUpdates);
            await instance.save();

            // ⭐ CRITICAL: Log saved state for debugging (BREAK #2 fix)
            const historyConfigObj = instance.historyConfig as any || {};
            const persistenceConfigObj = instance.persistenceConfig as any || {};
            const persistenceSummary = summarizePersistenceConfigBoundary(persistenceConfigObj);
            console.log('[AgentInstances] ✅ PUT endpoint saved:', {
                instanceId: instance._id?.toString(),
                name: instance.name,
                role: instance.role,
                capabilitiesCount: Array.isArray(instance.capabilities) ? instance.capabilities.length : 0,
                capabilitiesList: Array.isArray(instance.capabilities) ? instance.capabilities : [],
                historyConfig: {
                    enabled: historyConfigObj.enabled || false,
                    provider: historyConfigObj.llmProvider || 'unknown'
                },
                persistenceConfig: persistenceSummary,
                toolsCount: Array.isArray(instance.tools) ? instance.tools.length : 0
            });

            // Marquer workflow comme dirty
            const workflow = await Workflow.findById(instance.workflowId);
            if (workflow) {
                workflow.isDirty = true;
                await workflow.save();
            }

            res.json(transformAgentInstanceForFrontend(instance));
        } catch (error) {
            console.error('[AgentInstances] PUT error:', error);
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
            res.status(500).json({ error: 'Erreur mise à jour instance' });
        }
    }
);

// ============================================
// ⭐ AUTO-SAVE: POST /api/agent-instances/:id/content
// Ajouter du contenu (chat, image, video, error) à une instance
// Appelé automatiquement après chaque interaction chat
// ============================================
const contentSchema = z.object({
    content: z.object({
        type: z.enum(['chat', 'image', 'video', 'error']),
        role: z.string().optional(),
        message: z.string().optional(),
        mediaId: z.string().optional(),
        prompt: z.string().optional(),
        url: z.string().optional(),
        duration: z.number().optional(),
        subType: z.string().optional(),
        timestamp: z.string().or(z.date()).optional(),
        metadata: z.object({}).passthrough().optional()
    })
});

router.post('/:id/content',
    requireAuth,
    validateRequest(contentSchema),
    async (req: Request, res: Response) => {
        try {
            const user = req.user as IUser;
            const instanceId = req.params.id;
            const { content } = req.body;

            // Validate ObjectId
            if (!mongoose.Types.ObjectId.isValid(instanceId)) {
                return res.status(400).json({ error: 'ID instance invalide' });
            }

            // Find instance and verify ownership
            const instance = await AgentInstance.findOne({ 
                _id: instanceId, 
                userId: user.id 
            });

            if (!instance) {
                return res.status(404).json({ error: 'Instance introuvable' });
            }

            // Add content with timestamp
            const contentWithTimestamp = {
                ...content,
                timestamp: content.timestamp ? new Date(content.timestamp) : new Date()
            };

            // Push to content array
            instance.content.push(contentWithTimestamp);

            // Update metrics based on content type
            if (content.type === 'chat') {
                instance.metrics.callCount = (instance.metrics.callCount || 0) + 1;
                if (content.metadata?.tokensUsed) {
                    instance.metrics.totalTokens = (instance.metrics.totalTokens || 0) + content.metadata.tokensUsed;
                }
            } else if (content.type === 'error') {
                instance.metrics.totalErrors = (instance.metrics.totalErrors || 0) + 1;
            } else if (content.type === 'image' || content.type === 'video') {
                instance.metrics.totalMediaGenerated = (instance.metrics.totalMediaGenerated || 0) + 1;
            }

            await instance.save();

            console.log(`[AgentInstances] ✅ Content added to ${instanceId}: ${content.type}`);
            res.status(201).json({ 
                success: true, 
                contentCount: instance.content.length 
            });

        } catch (error) {
            console.error('[AgentInstances] POST/:id/content error:', error);
            res.status(500).json({ error: 'Erreur ajout contenu' });
        }
    }
);

// POST /api/workflows/:workflowId/instances/:agentInstanceId/journal
// Persister une entrée journal pour une instance d'agent
// Respecte la persistenceConfig granulaire
// ⭐ DÉDUPLICATION: Vérifie si le messageId existe déjà pour éviter les doublons
router.post(
    '/:agentInstanceId/journal',
    requireAuth,
    requireOwnershipAsync(async (req) => {
        const instance = await AgentInstance.findById(req.params.agentInstanceId);
        return instance?.userId.toString() || null;
    }),
    async (req: Request, res: Response) => {
        try {
            const { agentInstanceId } = req.params;
            const { type, payload } = req.body;
            const user = req.user as IUser;

            // Validation du type d'entrée
            if (!['chat', 'error', 'media', 'tool_invocation'].includes(type)) {
                return res.status(400).json({ 
                    error: 'Invalid journal entry type',
                    validTypes: ['chat', 'error', 'media', 'tool_invocation']
                });
            }

            // Récupérer l'instance
            const instance = await AgentInstance.findById(agentInstanceId);
            if (!instance) {
                return res.status(404).json({ error: 'Agent instance not found' });
            }

            // Vérifier ownership
            if (instance.userId.toString() !== user.id) {
                return res.status(403).json({ error: 'Unauthorized - user does not own this instance' });
            }

            const result = await journalService.persistJournalEntry({
                instanceId: agentInstanceId,
                type,
                payload
            });

            if (!result.success) {
                return res.status(500).json({ error: result.error || 'Failed to create journal entry' });
            }

            if (!result.saved) {
                return res.status(200).json({
                    skipped: true,
                    reason: result.reason,
                    ...(result.existingEntryId ? { existingJournalId: result.existingEntryId } : {})
                });
            }

            console.log(`[Journal] Created ${type} entry for instance ${agentInstanceId}`);
            res.json({ success: true, journalId: result.entryId });
        } catch (error) {
            console.error('[Journal] POST error:', error);
            res.status(500).json({ error: 'Failed to create journal entry' });
        }
    }
);

router.post(
    '/:agentInstanceId/imported-media',
    requireAuth,
    requireOwnershipAsync(async (req) => {
        const instance = await AgentInstance.findById(req.params.agentInstanceId);
        return instance?.userId.toString() || null;
    }),
    validateRequest(importedMediaDraftSchema),
    async (req: Request, res: Response) => {
        try {
            const workflowId = typeof req.params.workflowId === 'string' ? req.params.workflowId : undefined;
            const agentInstanceId = typeof req.params.agentInstanceId === 'string' ? req.params.agentInstanceId : null;

            if (!agentInstanceId) {
                return res.status(400).json({ error: 'Missing agentInstanceId route parameter' });
            }

            const { attachmentId, fileName, mimeType, contentBase64, origin } = req.body as z.infer<typeof importedMediaDraftSchema>;
            const user = req.user as IUser;

            const instance = await AgentInstance.findById(agentInstanceId);
            if (!instance) {
                return res.status(404).json({ error: 'Agent instance not found' });
            }

            if (instance.userId.toString() !== user.id) {
                return res.status(403).json({ error: 'Unauthorized - user does not own this instance' });
            }

            if (workflowId && instance.workflowId.toString() !== workflowId) {
                return res.status(400).json({ error: 'workflowId mismatch for imported media' });
            }

            const fileBuffer = Buffer.from(contentBase64, 'base64');
            if (fileBuffer.length === 0) {
                return res.status(400).json({ error: 'Imported media payload is empty' });
            }

            const result = await journalService.logMedia({
                instanceId: agentInstanceId,
                userId: user.id,
                workflowId: instance.workflowId.toString(),
                file: fileBuffer,
                metadata: {
                    originalName: fileName,
                    mimeType,
                    size: fileBuffer.length,
                    generatedBy: instance.name,
                },
                correlationIds: {
                    messageId: buildDraftImportMessageId(origin, attachmentId),
                },
            });

            if (!result.success) {
                return res.status(500).json({ error: result.error || 'Failed to import media draft' });
            }

            if (!result.saved) {
                return res.status(200).json({
                    skipped: true,
                    reason: result.reason,
                    ...(result.existingEntryId ? { existingJournalId: result.existingEntryId } : {}),
                });
            }

            console.log(`[Journal] Imported media draft for instance ${agentInstanceId}`);
            return res.status(200).json({ success: true, journalId: result.entryId });
        } catch (error) {
            console.error('[Journal] Imported media draft POST error:', error);
            return res.status(500).json({ error: 'Failed to import media draft' });
        }
    }
);

// DELETE /api/agent-instances/:id - Supprimer instance
// ⭐ POLICY DELETE: supprime les médias ou les conserve comme orphelins
router.delete('/:id',
    requireAuth,
    requireOwnershipAsync(async (req) => {
        const instance = await AgentInstance.findById(req.params.id);
        return instance ? instance.userId.toString() : null;
    }),
    requireRobotGovernance({
        governedType: 'agent',
        operation: 'delete',
        resolveTargetRobotId: async (req) => {
            const instance = await AgentInstance.findById(req.params.id).select('robotId');
            return instance?.robotId;
        }
    }),
    async (req, res) => {
        try {
            const user = req.user as IUser;
            const instanceId = req.params.id;
            const queryParseResult = deleteAgentInstanceQuerySchema.safeParse(req.query);

            if (!queryParseResult.success) {
                return res.status(400).json({
                    error: 'Paramètres invalides',
                    details: queryParseResult.error.errors,
                });
            }

            const instance = await AgentInstance.findOne({ _id: instanceId, userId: user.id });

            if (!instance) {
                return res.status(404).json({ error: 'Instance introuvable' });
            }

            const workflowId = instance.workflowId;

            const deletionResult = await new AgentInstanceDeletionPolicyService().deleteInstanceWithPolicy({
                userId: user.id,
                workflowId: workflowId.toString(),
                instanceId,
                mediaPolicy: queryParseResult.data.mediaPolicy,
                auditOrigin: 'agent_instance_delete_route',
                triggeredBy: user.id,
            });

            // Marquer workflow comme dirty
            const workflow = await Workflow.findById(workflowId);
            if (workflow) {
                workflow.isDirty = true;
                await workflow.save();
            }

            res.json({ 
                message: deletionResult.mediaPolicy === 'orphan_media'
                    ? 'Instance supprimée, médias conservés comme orphelins'
                    : 'Instance et données associées supprimées',
                mediaPolicy: deletionResult.mediaPolicy,
                cascadeDelete: {
                    journalsDeleted: deletionResult.journalsDeleted,
                    mediaFilesDeleted: deletionResult.mediaFilesDeleted,
                    mediaReferencesDeleted: deletionResult.mediaReferencesDeleted,
                    mediaReferencesOrphaned: deletionResult.mediaReferencesOrphaned,
                    retainedMediaEntries: deletionResult.retainedMediaEntries,
                },
                audit: {
                    journalId: deletionResult.audit.journalId || null,
                    severity: deletionResult.audit.severity,
                    anomalyCount: deletionResult.audit.anomalyCount,
                    anomalyCodes: deletionResult.audit.anomalies.map((anomaly) => anomaly.code),
                    origin: deletionResult.audit.origin,
                },
            });
        } catch (error) {
            console.error('[AgentInstances] DELETE error:', error);

            if (error instanceof Error && error.message === 'INSTANCE_NOT_FOUND') {
                return res.status(404).json({ error: 'Instance introuvable' });
            }

            res.status(500).json({ error: 'Erreur suppression instance' });
        }
    }
);

// GET /api/workflows/:workflowId/instances/:id/journals - Charger tous les journaux (lazy-load)
router.get('/:id/journals',
    requireAuth,
    requireOwnershipAsync(async (req) => {
        const instance = await AgentInstance.findById(req.params.id);
        return instance ? instance.userId.toString() : null;
    }),
    async (req, res) => {
        try {
            const user = req.user as IUser;
            const { id: instanceId } = req.params;

            // Vérifier l'ownership
            const instance = await AgentInstance.findOne({ _id: instanceId, userId: user.id });
            if (!instance) {
                return res.status(403).json({ error: 'Unauthorized - user does not own this instance' });
            }

            // Récupérer TOUS les journaux pour cette instance, triés par timestamp (ancien → récent)
            const journals = await AgentJournal.find({ agentInstanceId: instanceId })
                .sort({ timestamp: 1 }) // ⭐ FIX: Use timestamp field (not createdAt), order: oldest first
                .lean();

            console.log(`[Journals] Loaded ${journals.length} entries for instance ${instanceId}`);

            res.json({
                success: true,
                instanceId,
                journals: journals || [],
                count: journals?.length || 0
            });
        } catch (error) {
            console.error('[Journals] GET error:', error);
            res.status(500).json({ error: 'Failed to load journals' });
        }
    }
);

export default router;

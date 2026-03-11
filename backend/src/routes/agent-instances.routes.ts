import { Router, Request, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { AgentInstance } from '../models/AgentInstance.model';
import { AgentPrototype } from '../models/AgentPrototype.model';
import { Workflow } from '../models/Workflow.model';
import { AgentJournal } from '../models/AgentJournal.model';
import { requireAuth, requireOwnershipAsync } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import { IUser } from '../models/User.model';
import { transformAgentInstanceForFrontend } from '../utils/transforms';

// Type pour les paramètres de route hérités (via mergeParams)
interface WorkflowParams {
    workflowId: string;
    id?: string;
}

// CORRECTION SOLID: mergeParams: true pour hériter des paramètres du parent (:workflowId)
const router = Router({ mergeParams: true });

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
    outputConfig: z.object({}).passthrough().optional(),
    robotId: z.enum(['AR_001', 'BOS_001', 'COM_001', 'PHIL_001', 'TIM_001']),
    
    // ⭐ FIX QA: Add persistenceConfig to validation schema for media storage
    persistenceConfig: z.object({
        saveChat: z.boolean().optional(),
        saveErrors: z.boolean().optional(),
        saveHistorySummary: z.boolean().optional(),
        saveLinks: z.boolean().optional(),
        saveTasks: z.boolean().optional(),
        saveMedia: z.boolean().optional(),
        mediaStorage: z.enum(['db', 'local', 'cloud']).optional(), // ⭐ FIX: Use 'db' not 'database'
        cloudStorageConfig: z.object({}).passthrough().optional()
    }).optional(),

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
        overrideFunctionIds: z.array(z.string()).optional()
    }).optional()
});

const updateAgentInstanceSchema = createAgentInstanceSchema.partial();

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
            const instance = await AgentInstance.findById(req.params.id);

            if (!instance) {
                return res.status(404).json({ error: 'Instance introuvable' });
            }

            // ⭐ FIX: Transform instance for frontend consumption
            res.json(transformAgentInstanceForFrontend(instance));
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

            const instance = new AgentInstance({
                workflowId,
                userId: user.id,
                prototypeId: prototypeId || undefined,
                ...instanceData
            });

            await instance.save();

            // Marquer workflow comme dirty
            workflow.isDirty = true;
            await workflow.save();

            res.status(201).json(instance);
        } catch (error) {
            console.error('[AgentInstances] POST error:', error);
            res.status(500).json({ error: 'Erreur création instance' });
        }
    }
);

// POST /api/workflows/:workflowId/instances/from-prototype - Créer instance depuis prototype
// ⭐ MERGE STRATEGY: prototype (source) + body overrides (name, persistenceConfig)
router.post('/from-prototype', requireAuth, async (req: Request<WorkflowParams>, res: Response) => {
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
        
        // 4. PHASE 2 - HistoryConfig: Use frontend config if provided
        const finalHistoryConfig = configuration_json?.historyConfig || prototype.historyConfig || {};
        const finalOutputConfig = configuration_json?.outputConfig || prototype.outputConfig || {};
        
        // 5. PersistenceConfig: merge prototype config avec overrides
        const prototypePersistenceConfig = prototype.persistenceConfig || {
            saveChat: true,
            saveErrors: true,
            saveHistorySummary: false,
            saveLinks: false,
            saveTasks: false,
            mediaStorage: 'db'
        };
        
        const finalPersistenceConfig = persistenceConfig 
            ? { ...prototypePersistenceConfig, ...persistenceConfig }
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
            tools: finalTools,
            robotId: finalRobotId,

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
                overrideFunctionIds: []
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
                persistenceConfig: req.body.persistenceConfig
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
                
                // ARRAYS: Capabilities + tools
                if (Array.isArray(configuration_json.capabilities)) {
                    instance.capabilities = configuration_json.capabilities;
                }
                if (Array.isArray(configuration_json.tools)) {
                    instance.tools = configuration_json.tools;
                }
                
                // OBJECTS: HistoryConfig + OutputConfig
                if (configuration_json.historyConfig !== undefined) {
                    instance.historyConfig = configuration_json.historyConfig;
                }
                if (configuration_json.outputConfig !== undefined) {
                    instance.outputConfig = configuration_json.outputConfig;
                }
                // J6: Function Inheritance
                if (configuration_json.functionInheritance !== undefined) {
                    instance.functionInheritance = configuration_json.functionInheritance;
                }
                
                // PRESERVE RUNTIME DATA: Never overwrite logs, errors, tasks, links from frontend
                // These should only be updated by auto-save endpoints
                // Skip: configuration_json.logs, errors, tasks, links (backend-only)
            }
            
            // Apply other updates (name, position, etc.) using Object.assign
            Object.assign(instance, otherUpdates);
            await instance.save();

            // ⭐ CRITICAL: Log saved state for debugging (BREAK #2 fix)
            const historyConfigObj = instance.historyConfig as any || {};
            const persistenceConfigObj = instance.persistenceConfig as any || {};
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
                persistenceConfig: {
                    saveMedia: persistenceConfigObj.saveMedia || false,
                    mediaStorage: persistenceConfigObj.mediaStorage || 'db'
                },
                toolsCount: Array.isArray(instance.tools) ? instance.tools.length : 0
            });

            // Marquer workflow comme dirty
            const workflow = await Workflow.findById(instance.workflowId);
            if (workflow) {
                workflow.isDirty = true;
                await workflow.save();
            }

            res.json(instance);
        } catch (error) {
            console.error('[AgentInstances] PUT error:', error);
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
            if (!['chat', 'error', 'media'].includes(type)) {
                return res.status(400).json({ 
                    error: 'Invalid journal entry type',
                    validTypes: ['chat', 'error', 'media']
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

            // ⭐ DÉDUPLICATION BACKEND: Vérifier si ce message existe déjà
            if (payload?.messageId) {
                const existingEntry = await AgentJournal.findOne({
                    agentInstanceId: instance._id,
                    'payload.messageId': payload.messageId
                });
                
                if (existingEntry) {
                    console.log(`[Journal] SKIP duplicate: messageId ${payload.messageId} already exists`);
                    return res.status(200).json({ 
                        skipped: true, 
                        reason: 'Duplicate messageId - entry already exists',
                        existingJournalId: existingEntry._id
                    });
                }
            }

            const { persistenceConfig } = instance;

            let result;

            // Persister selon le type ET la config
            switch (type) {
                case 'chat':
                    if (!persistenceConfig?.saveChat) {
                        return res.status(200).json({ 
                            skipped: true, 
                            reason: 'saveChat is false in persistenceConfig' 
                        });
                    }
                    result = await AgentJournal.createChatEntry(
                        instance._id,
                        instance.workflowId,
                        payload
                    );
                    break;

                case 'error':
                    if (!persistenceConfig?.saveErrors) {
                        return res.status(200).json({ 
                            skipped: true, 
                            reason: 'saveErrors is false in persistenceConfig' 
                        });
                    }
                    result = await AgentJournal.createErrorEntry(
                        instance._id,
                        instance.workflowId,
                        payload
                    );
                    break;

                case 'media':
                    if (!persistenceConfig?.saveMedia) {
                        return res.status(200).json({ 
                            skipped: true, 
                            reason: 'saveMedia is false in persistenceConfig' 
                        });
                    }
                    result = await AgentJournal.createMediaEntry(
                        instance._id,
                        instance.workflowId,
                        payload
                    );
                    break;

                default:
                    return res.status(400).json({ error: 'Unhandled journal type' });
            }

            console.log(`[Journal] Created ${type} entry for instance ${agentInstanceId}`);
            res.json({ success: true, journalId: result._id });
        } catch (error) {
            console.error('[Journal] POST error:', error);
            res.status(500).json({ error: 'Failed to create journal entry' });
        }
    }
);

// DELETE /api/agent-instances/:id - Supprimer instance
// ⭐ CASCADE DELETE: Supprime aussi les journaux et médias associés
router.delete('/:id',
    requireAuth,
    requireOwnershipAsync(async (req) => {
        const instance = await AgentInstance.findById(req.params.id);
        return instance ? instance.userId.toString() : null;
    }),
    async (req, res) => {
        try {
            const user = req.user as IUser;
            const instanceId = req.params.id;
            const instance = await AgentInstance.findOne({ _id: instanceId, userId: user.id });

            if (!instance) {
                return res.status(404).json({ error: 'Instance introuvable' });
            }

            const workflowId = instance.workflowId;
            
            // ⭐ CASCADE DELETE: Supprimer les journaux de l'instance (inclut les médias en base64)
            const journalDeleteResult = await AgentJournal.deleteMany({ agentInstanceId: instanceId });
            console.log(`[AgentInstances] CASCADE DELETE: ${journalDeleteResult.deletedCount} journals deleted for instance ${instanceId}`);
            
            // Supprimer l'instance elle-même
            await instance.deleteOne();

            // Marquer workflow comme dirty
            const workflow = await Workflow.findById(workflowId);
            if (workflow) {
                workflow.isDirty = true;
                await workflow.save();
            }

            res.json({ 
                message: 'Instance et données associées supprimées',
                cascadeDelete: {
                    journalsDeleted: journalDeleteResult.deletedCount
                }
            });
        } catch (error) {
            console.error('[AgentInstances] DELETE error:', error);
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

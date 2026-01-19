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

    // Canvas properties
    position: z.object({
        x: z.number(),
        y: z.number()
    }),
    isMinimized: z.boolean().default(false),
    isMaximized: z.boolean().default(false),
    zIndex: z.number().default(0)
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
        res.json(instances);
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

            res.json(instance);
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
        const { prototypeId, position, name, persistenceConfig } = req.body;

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

        // ⭐ MERGE STRATEGY: prototype comme base + overrides frontend + FALLBACKS
        // 1. Name: utiliser override si fourni, sinon prototype.name, sinon fallback
        const finalName = name?.trim() || prototype.name || 'Agent sans nom';
        
        // 2. Champs requis avec fallbacks robustes (évite ValidationError)
        const finalRole = prototype.role?.trim() || 'Assistant généraliste';
        const finalSystemPrompt = prototype.systemPrompt?.trim() || 'Tu es un assistant IA utile et professionnel.';
        const finalLlmProvider = prototype.llmProvider || 'openai';
        const finalLlmModel = prototype.llmModel || 'gpt-4o-mini';
        const finalRobotId = prototype.robotId || 'AR_001';
        
        // 3. Tableaux: s'assurer qu'ils ne sont jamais undefined
        const finalCapabilities = Array.isArray(prototype.capabilities) ? prototype.capabilities : [];
        const finalTools = Array.isArray(prototype.tools) ? prototype.tools : [];
        
        // 4. PersistenceConfig: merge prototype config avec overrides
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
        console.log('[AgentInstances] 📋 Instance data prepared:', {
            name: finalName,
            role: finalRole,
            llmProvider: finalLlmProvider,
            llmModel: finalLlmModel,
            robotId: finalRobotId,
            hasTools: finalTools.length,
            hasCapabilities: finalCapabilities.length
        });

        // Créer instance avec snapshot du prototype + overrides + fallbacks
        const instance = new AgentInstance({
            workflowId,
            userId: user.id,
            prototypeId: prototype.id,

            // ⭐ executionId unique (required)
            executionId,
            status: 'running',

            // Snapshot config avec fallbacks robustes
            name: finalName,
            role: finalRole,
            systemPrompt: finalSystemPrompt,
            llmProvider: finalLlmProvider,
            llmModel: finalLlmModel,
            capabilities: finalCapabilities,
            historyConfig: prototype.historyConfig || {},
            tools: finalTools,
            outputConfig: prototype.outputConfig || {},
            robotId: finalRobotId,

            // Canvas properties
            position,
            isMinimized: false,
            isMaximized: false,
            zIndex: 0,

            // persistenceConfig avec overrides
            persistenceConfig: finalPersistenceConfig,

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

        console.log('[AgentInstances] ✅ Instance créée depuis prototype:', {
            instanceId: instance._id,
            executionId,
            prototypeId: prototype.id,
            name: finalName
        });

        res.status(201).json(instance);
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
            const instance = await AgentInstance.findOne({ _id: req.params.id, userId: user.id });

            if (!instance) {
                return res.status(404).json({ error: 'Instance introuvable' });
            }

            // Empêcher modification workflowId, userId
            delete req.body.workflowId;
            delete req.body.userId;

            Object.assign(instance, req.body);
            await instance.save();

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
router.delete('/:id',
    requireAuth,
    requireOwnershipAsync(async (req) => {
        const instance = await AgentInstance.findById(req.params.id);
        return instance ? instance.userId.toString() : null;
    }),
    async (req, res) => {
        try {
            const user = req.user as IUser;
            const instance = await AgentInstance.findOne({ _id: req.params.id, userId: user.id });

            if (!instance) {
                return res.status(404).json({ error: 'Instance introuvable' });
            }

            const workflowId = instance.workflowId;
            await instance.deleteOne();

            // Marquer workflow comme dirty
            const workflow = await Workflow.findById(workflowId);
            if (workflow) {
                workflow.isDirty = true;
                await workflow.save();
            }

            res.json({ message: 'Instance supprimée' });
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

            // Récupérer TOUS les journaux pour cette instance, triés par timestamp
            const journals = await AgentJournal.find({ agentInstanceId: instanceId })
                .sort({ createdAt: 1 }) // Oldest first
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

/**
 * @fileoverview Contrôleur Instances - Gestion des agents individuels
 * 
 * Implémente les endpoints de lazy loading et gestion des journaux :
 * - GET /api/instances/:id (chargement détails agent)
 * - PATCH /api/instances/:id (mise à jour état/config)
 * - GET /api/instances/:id/journals (historique paginé)
 * 
 * @see Guides/WIP/PERSISTANCES_ROUTES.md
 */

import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { AgentInstanceV2 } from '../models/AgentInstanceV2.model';
import { AgentJournal } from '../models/AgentJournal.model';
import { IUser } from '../models/User.model';
import { journalService } from '../services/journal.service';
import {
    JournalEntryType,
    JournalSeverity,
    JournalQueryParams,
    JournalPaginatedResponse,
    AgentInstanceStatus,
    AgentRuntimeState,
    PersistenceConfig
} from '../types/persistence';

// ============================================
// VALIDATION SCHEMAS
// ============================================

const UpdateInstanceBodySchema = z.object({
    state: z.object({
        memory: z.string().optional(),
        variables: z.record(z.unknown()).optional(),
        currentTask: z.string().optional()
    }).optional(),
    status: z.enum(['idle', 'running', 'error', 'paused', 'completed']).optional(),
    persistenceConfig: z.object({
        // ⭐ New properties
        saveChat: z.boolean().optional(),
        saveChatHistory: z.boolean().optional(),
        saveErrors: z.boolean().optional(),
        saveTasks: z.boolean().optional(),
        saveTaskExecution: z.boolean().optional(),
        saveLinks: z.boolean().optional(),
        saveMedia: z.boolean().optional(),
        mediaStorage: z.enum(['db', 'local', 'cloud']).optional(),
        saveHistorySummary: z.boolean().optional(),
        // ⭐ Legacy properties (backward compatibility)
        mediaStorageMode: z.enum(['database', 'local', 'cloud']).optional(),
        summarizeHistory: z.boolean().optional(),
        retentionDays: z.number().positive().optional()
    }).optional()
});

// ============================================
// TYPES
// ============================================

interface AuthenticatedRequest extends Request {
    user: IUser;
}

// ============================================
// CONTRÔLEUR
// ============================================

export class InstanceController {
    /**
     * GET /api/instances/:id
     * 
     * Charge la configuration et l'état complet d'une instance d'agent.
     * Endpoint de lazy loading - appelé au clic sur un nœud.
     */
    static async getInstance(
        req: AuthenticatedRequest,
        res: Response
    ): Promise<void> {
        try {
            const instanceId = req.params.id;
            const user = req.user;

            // Validation de l'ObjectId
            if (!mongoose.Types.ObjectId.isValid(instanceId)) {
                res.status(400).json({ error: 'ID instance invalide' });
                return;
            }

            // Récupérer l'instance avec vérification propriétaire
            const instance = await AgentInstanceV2.findOne({
                _id: instanceId,
                userId: user.id
            }).lean();

            if (!instance) {
                res.status(404).json({ error: 'Instance introuvable' });
                return;
            }

            // Retourner les détails (sans l'historique)
            res.json({
                _id: instance._id,
                workflowId: instance.workflowId,
                prototypeId: instance.prototypeId,
                name: instance.name,
                role: instance.role,
                robotId: instance.robotId,
                configuration: instance.configuration,
                persistenceConfig: instance.persistenceConfig,
                state: instance.state,
                status: instance.status,
                createdAt: instance.createdAt,
                updatedAt: instance.updatedAt
            });

        } catch (error) {
            console.error('[InstanceController] getInstance error:', error);
            res.status(500).json({
                error: 'Erreur récupération instance',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * PATCH /api/instances/:id
     * 
     * Met à jour l'état ou la configuration d'une instance.
     * Utilisé pour :
     * - Changer le statut (idle → running, etc.)
     * - Sauvegarder la mémoire/variables
     * - Modifier la config de persistance
     */
    static async updateInstance(
        req: AuthenticatedRequest,
        res: Response
    ): Promise<void> {
        try {
            const instanceId = req.params.id;
            const user = req.user;

            // Validation du body
            const parseResult = UpdateInstanceBodySchema.safeParse(req.body);
            if (!parseResult.success) {
                res.status(400).json({
                    error: 'Validation error',
                    details: parseResult.error.flatten()
                });
                return;
            }

            const updates = parseResult.data;

            // Vérifier l'existence et le propriétaire
            const instance = await AgentInstanceV2.findOne({
                _id: instanceId,
                userId: user.id
            });

            if (!instance) {
                res.status(404).json({ error: 'Instance introuvable' });
                return;
            }

            // Construction des updates MongoDB
            const setFields: Record<string, unknown> = {};

            if (updates.state) {
                // Merge partiel de l'état
                if (updates.state.memory !== undefined) {
                    setFields['state.memory'] = updates.state.memory;
                }
                if (updates.state.variables !== undefined) {
                    setFields['state.variables'] = updates.state.variables;
                }
                if (updates.state.currentTask !== undefined) {
                    setFields['state.currentTask'] = updates.state.currentTask;
                }
                setFields['state.lastActivity'] = new Date();
            }

            if (updates.status) {
                setFields.status = updates.status;
            }

            if (updates.persistenceConfig) {
                // Merge partiel de la config de persistance
                for (const [key, value] of Object.entries(updates.persistenceConfig)) {
                    if (value !== undefined) {
                        setFields[`persistenceConfig.${key}`] = value;
                    }
                }

                // Logger le changement de config via JournalService
                await journalService.logSystem(
                    instanceId,
                    'persistence_config_updated',
                    {
                        changes: updates.persistenceConfig,
                        triggeredBy: user.id
                    }
                );
            }

            // Appliquer les updates
            const updatedInstance = await AgentInstanceV2.findByIdAndUpdate(
                instanceId,
                { $set: setFields },
                { new: true }
            ).lean();

            res.json({
                success: true,
                instance: {
                    _id: updatedInstance?._id,
                    status: updatedInstance?.status,
                    state: updatedInstance?.state,
                    persistenceConfig: updatedInstance?.persistenceConfig,
                    updatedAt: updatedInstance?.updatedAt
                }
            });

        } catch (error) {
            console.error('[InstanceController] updateInstance error:', error);
            res.status(500).json({
                error: 'Erreur mise à jour instance',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * GET /api/instances/:id/journals
     * 
     * Récupère l'historique paginé d'une instance.
     * Supporte le filtrage par type et sévérité.
     * 
     * Query params:
     * - type: 'chat' | 'error' | 'media' | 'task' | 'system'
     * - severity: 'info' | 'warn' | 'error'
     * - page: number (défaut: 1)
     * - limit: number (défaut: 50)
     * - startDate: ISO date string
     * - endDate: ISO date string
     */
    static async getJournals(
        req: AuthenticatedRequest,
        res: Response
    ): Promise<void> {
        try {
            const instanceId = req.params.id;
            const user = req.user;

            // Validation de l'ObjectId
            if (!mongoose.Types.ObjectId.isValid(instanceId)) {
                res.status(400).json({ error: 'ID instance invalide' });
                return;
            }

            // Vérifier que l'instance appartient à l'utilisateur
            const instance = await AgentInstanceV2.findOne({
                _id: instanceId,
                userId: user.id
            }).select('_id');

            if (!instance) {
                res.status(404).json({ error: 'Instance introuvable' });
                return;
            }

            // Parser les query params
            const queryParams: JournalQueryParams = {
                type: req.query.type as JournalEntryType | undefined,
                severity: req.query.severity as JournalSeverity | undefined,
                page: parseInt(req.query.page as string) || 1,
                limit: Math.min(parseInt(req.query.limit as string) || 50, 100),
                startDate: req.query.startDate as string | undefined,
                endDate: req.query.endDate as string | undefined
            };

            // Validation du type si fourni
            if (queryParams.type && !['chat', 'error', 'media', 'task', 'system'].includes(queryParams.type)) {
                res.status(400).json({ error: 'Type de journal invalide' });
                return;
            }

            // Validation de la sévérité si fournie
            if (queryParams.severity && !['info', 'warn', 'error'].includes(queryParams.severity)) {
                res.status(400).json({ error: 'Sévérité invalide' });
                return;
            }

            // Utiliser la méthode statique du modèle
            const result = await AgentJournal.findByInstance(instanceId, {
                type: queryParams.type,
                severity: queryParams.severity,
                page: queryParams.page,
                limit: queryParams.limit,
                startDate: queryParams.startDate ? new Date(queryParams.startDate) : undefined,
                endDate: queryParams.endDate ? new Date(queryParams.endDate) : undefined
            });

            const response: JournalPaginatedResponse = {
                data: result.data,
                meta: {
                    total: result.total,
                    page: queryParams.page || 1,
                    pages: result.pages,
                    limit: queryParams.limit || 50
                }
            };

            res.json(response);

        } catch (error) {
            console.error('[InstanceController] getJournals error:', error);
            res.status(500).json({
                error: 'Erreur récupération journaux',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * POST /api/instances/:id/journals
     * 
     * Ajouter une entrée au journal (utilisé par le runtime).
     * Respecte la configuration de persistance de l'agent.
     */
    static async addJournalEntry(
        req: AuthenticatedRequest,
        res: Response
    ): Promise<void> {
        try {
            const instanceId = req.params.id;
            const user = req.user;
            const { type, severity, payload, sessionId } = req.body;

            // Validation basique
            if (!type || !payload) {
                res.status(400).json({ error: 'Type et payload requis' });
                return;
            }

            // Récupérer l'instance avec sa config de persistance
            const instance = await AgentInstanceV2.findOne({
                _id: instanceId,
                userId: user.id
            }).select('_id workflowId persistenceConfig');

            if (!instance) {
                res.status(404).json({ error: 'Instance introuvable' });
                return;
            }

            // Vérifier si ce type doit être sauvegardé selon la config
            const config = instance.persistenceConfig;
            let shouldSave = true;

            switch (type) {
                case 'chat':
                    shouldSave = config.saveChatHistory ?? config.saveChat ?? true;
                    break;
                case 'error':
                    shouldSave = config.saveErrors ?? true;
                    break;
                case 'task':
                    shouldSave = config.saveTaskExecution ?? config.saveTasks ?? false;
                    break;
                case 'media':
                    shouldSave = config.saveMedia ?? true;
                    break;
                case 'system':
                    shouldSave = true; // Toujours logger les événements système
                    break;
            }

            if (!shouldSave) {
                res.json({
                    success: true,
                    saved: false,
                    reason: `Type "${type}" désactivé dans la configuration de persistance`
                });
                return;
            }

            // Créer l'entrée
            const entry = await AgentJournal.create({
                agentInstanceId: instance._id,
                workflowId: instance.workflowId,
                type,
                severity: severity || 'info',
                payload,
                sessionId,
                timestamp: new Date()
            });

            res.status(201).json({
                success: true,
                saved: true,
                entry: {
                    _id: entry._id,
                    type: entry.type,
                    timestamp: entry.timestamp
                }
            });

        } catch (error) {
            console.error('[InstanceController] addJournalEntry error:', error);
            res.status(500).json({
                error: 'Erreur ajout entrée journal',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * POST /api/instances/:id/chat
     * 
     * Endpoint optimisé pour journaliser un message de chat.
     * Utilise le JournalService pour la logique conditionnelle.
     */
    static async logChatMessage(
        req: AuthenticatedRequest,
        res: Response
    ): Promise<void> {
        try {
            const instanceId = req.params.id;
            const user = req.user;
            const { role, content, model, tokensUsed, toolCalls, sessionId } = req.body;

            // Validation basique
            if (!role || !content) {
                res.status(400).json({ error: 'Role et content requis' });
                return;
            }

            // Vérifier que l'utilisateur possède cette instance
            const instance = await AgentInstanceV2.findOne({
                _id: instanceId,
                userId: user.id
            }).select('_id');

            if (!instance) {
                res.status(404).json({ error: 'Instance introuvable' });
                return;
            }

            // Utiliser le JournalService
            const result = await journalService.logChat(
                {
                    instanceId,
                    role,
                    content,
                    model,
                    tokensUsed,
                    toolCalls
                },
                { sessionId }
            );

            if (result.success) {
                res.status(result.saved ? 201 : 200).json(result);
            } else {
                res.status(500).json(result);
            }

        } catch (error) {
            console.error('[InstanceController] logChatMessage error:', error);
            res.status(500).json({
                error: 'Erreur journalisation chat',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * POST /api/instances/:id/error
     * 
     * Endpoint optimisé pour journaliser une erreur.
     * Utilise le JournalService pour la logique conditionnelle.
     */
    static async logError(
        req: AuthenticatedRequest,
        res: Response
    ): Promise<void> {
        try {
            const instanceId = req.params.id;
            const user = req.user;
            const { code, message, stack, context, recoverable } = req.body;

            // Validation basique
            if (!code || !message) {
                res.status(400).json({ error: 'Code et message requis' });
                return;
            }

            // Vérifier que l'utilisateur possède cette instance
            const instance = await AgentInstanceV2.findOne({
                _id: instanceId,
                userId: user.id
            }).select('_id');

            if (!instance) {
                res.status(404).json({ error: 'Instance introuvable' });
                return;
            }

            // Utiliser le JournalService
            const result = await journalService.logError({
                instanceId,
                code,
                message,
                stack,
                context,
                recoverable
            });

            if (result.success) {
                res.status(result.saved ? 201 : 200).json(result);
            } else {
                res.status(500).json(result);
            }

        } catch (error) {
            console.error('[InstanceController] logError error:', error);
            res.status(500).json({
                error: 'Erreur journalisation erreur',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * PATCH /api/instances/:id/status
     * 
     * Endpoint simplifié pour mettre à jour le statut d'une instance.
     * Utilisé pour marquer le début/fin d'une interaction.
     */
    static async updateStatus(
        req: AuthenticatedRequest,
        res: Response
    ): Promise<void> {
        try {
            const instanceId = req.params.id;
            const user = req.user;
            const { status } = req.body;

            // Validation
            const validStatuses = ['idle', 'running', 'error', 'paused', 'completed'];
            if (!status || !validStatuses.includes(status)) {
                res.status(400).json({ 
                    error: 'Statut invalide',
                    validStatuses 
                });
                return;
            }

            // Vérifier que l'utilisateur possède cette instance
            const instance = await AgentInstanceV2.findOne({
                _id: instanceId,
                userId: user.id
            }).select('_id');

            if (!instance) {
                res.status(404).json({ error: 'Instance introuvable' });
                return;
            }

            // Utiliser le JournalService
            const success = await journalService.updateInstanceStatus(instanceId, status);

            if (success) {
                // Logger l'événement système
                await journalService.logSystem(instanceId, 'status_changed', {
                    newStatus: status,
                    triggeredBy: user.id
                });

                res.json({ success: true, status });
            } else {
                res.status(500).json({ error: 'Échec mise à jour statut' });
            }

        } catch (error) {
            console.error('[InstanceController] updateStatus error:', error);
            res.status(500).json({
                error: 'Erreur mise à jour statut',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
}

// ============================================
// EXPORT DES HANDLERS
// ============================================

export const getInstance = InstanceController.getInstance;
export const updateInstance = InstanceController.updateInstance;
export const getJournals = InstanceController.getJournals;
export const addJournalEntry = InstanceController.addJournalEntry;
export const logChatMessage = InstanceController.logChatMessage;
export const logError = InstanceController.logError;
export const updateStatus = InstanceController.updateStatus;

/**
 * @fileoverview Service de journalisation des événements agents - Jalon 4
 * 
 * Ce service centralise la logique de journalisation pour les agents :
 * - Vérifie la configuration de persistance avant d'enregistrer
 * - Gère les différents types d'événements (chat, error, media, task, system)
 * - Délègue le stockage média au MediaStorageService
 * - Met à jour l'état de l'instance après chaque interaction
 * 
 * Pattern : Service Layer avec injection de dépendances
 * 
 * ⚠️ ÉTAPE 4: Références AgentInstance à corriger vers AgentInstance
 * 
 * @see backend/src/models/AgentJournal.model.ts
 * @see backend/src/models/AgentInstance.model.ts
 * @see backend/src/services/mediaStorage.service.ts
 */

import mongoose from 'mongoose';
import { AgentInstance, IAgentInstance } from '../models/AgentInstance.model';
import { AgentJournal, IAgentJournal } from '../models/AgentJournal.model';
import { MediaStorageService } from './mediaStorage.service';
import {
    JournalEntryType,
    JournalSeverity,
    PersistenceConfig,
    ChatJournalPayload,
    ErrorJournalPayload,
    MediaJournalPayload,
    TaskJournalPayload,
    SystemJournalPayload,
    JournalPayload,
    FileMetadata,
    MediaPayload
} from '../types/persistence';

// ============================================
// TYPES
// ============================================

/**
 * Résultat d'une opération de journalisation
 */
export interface JournalResult {
    /** Opération réussie */
    success: boolean;
    /** Entrée effectivement sauvegardée en BDD */
    saved: boolean;
    /** ID de l'entrée créée (si sauvegardée) */
    entryId?: string;
    /** Raison si non sauvegardé */
    reason?: string;
    /** Erreur éventuelle */
    error?: string;
}

/**
 * Options pour la journalisation
 */
export interface JournalOptions {
    /** ID de session (pour regrouper les messages d'une conversation) */
    sessionId?: string;
    /** Timestamp explicite (sinon Date.now()) */
    timestamp?: Date;
    /** Sévérité de l'entrée */
    severity?: JournalSeverity;
}

/**
 * Paramètres pour journaliser un message chat
 */
export interface LogChatParams {
    instanceId: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    model?: string;
    tokensUsed?: number;
    toolCalls?: Array<{
        name: string;
        arguments: string;
        result?: string;
    }>;
}

/**
 * Paramètres pour journaliser une erreur
 */
export interface LogErrorParams {
    instanceId: string;
    code: string;
    message: string;
    stack?: string;
    context?: Record<string, unknown>;
    recoverable?: boolean;
}

/**
 * Paramètres pour journaliser un média
 */
export interface LogMediaParams {
    instanceId: string;
    userId: string;
    workflowId: string;
    file: Buffer;
    metadata: FileMetadata;
}

/**
 * Paramètres pour journaliser une tâche
 */
export interface LogTaskParams {
    instanceId: string;
    taskId: string;
    taskName: string;
    status: 'started' | 'completed' | 'failed' | 'cancelled';
    input?: unknown;
    output?: unknown;
    duration?: number;
    error?: string;
}

// ============================================
// SERVICE PRINCIPAL
// ============================================

export class JournalService {
    private mediaStorage: MediaStorageService;

    constructor(mediaStorage?: MediaStorageService) {
        this.mediaStorage = mediaStorage || new MediaStorageService();
    }

    // ============================================
    // MÉTHODES PRIVÉES
    // ============================================

    /**
     * Récupérer une instance avec sa config de persistance
     */
    private async getInstanceWithConfig(
        instanceId: string
    ): Promise<IAgentInstance | null> {
        if (!mongoose.Types.ObjectId.isValid(instanceId)) {
            return null;
        }

        return AgentInstance.findById(instanceId)
            .select('_id workflowId userId persistenceConfig state status')
            .lean() as unknown as Promise<IAgentInstance | null>;
    }

    /**
     * Vérifier si un type d'événement doit être sauvegardé
     */
    private shouldSaveEvent(
        type: JournalEntryType,
        config: PersistenceConfig
    ): boolean {
        switch (type) {
            case 'chat':
                return config.saveChatHistory ?? config.saveChat ?? true;
            case 'error':
                return config.saveErrors ?? true;
            case 'task':
                return config.saveTaskExecution ?? config.saveTasks ?? false;
            case 'media':
                return config.saveMedia ?? true;
            case 'system':
                return true; // Toujours sauvegarder les événements système
            default:
                return false;
        }
    }

    /**
     * Créer une entrée de journal générique
     */
    private async createJournalEntry(
        instance: IAgentInstance,
        type: JournalEntryType,
        payload: JournalPayload,
        options: JournalOptions = {}
    ): Promise<IAgentJournal> {
        const entry = await AgentJournal.create({
            agentInstanceId: instance._id,
            workflowId: instance.workflowId,
            type,
            severity: options.severity || 'info',
            payload,
            sessionId: options.sessionId,
            timestamp: options.timestamp || new Date()
        });

        return entry;
    }

    /**
     * Mettre à jour l'état de l'instance après une interaction
     */
    private async updateInstanceState(
        instanceId: string,
        stateUpdates: Partial<{
            lastActivity: Date;
            memory: string;
            variables: Record<string, unknown>;
            currentTask: string;
        }>
    ): Promise<void> {
        try {
            const setFields: Record<string, unknown> = {};
            
            if (stateUpdates.lastActivity) {
                setFields['state.lastActivity'] = stateUpdates.lastActivity;
            }
            if (stateUpdates.memory !== undefined) {
                setFields['state.memory'] = stateUpdates.memory;
            }
            if (stateUpdates.variables !== undefined) {
                setFields['state.variables'] = stateUpdates.variables;
            }
            if (stateUpdates.currentTask !== undefined) {
                setFields['state.currentTask'] = stateUpdates.currentTask;
            }

            await AgentInstance.findByIdAndUpdate(
                instanceId,
                { $set: setFields }
            );
        } catch (error) {
            // Non-bloquant : on log l'erreur mais on ne la propage pas
            console.error('[JournalService] Failed to update instance state:', error);
        }
    }

    // ============================================
    // MÉTHODES PUBLIQUES - JOURNALISATION
    // ============================================

    /**
     * Journaliser un message de chat
     * 
     * Respecte la config `saveChatHistory`
     */
    async logChat(
        params: LogChatParams,
        options: JournalOptions = {}
    ): Promise<JournalResult> {
        try {
            const instance = await this.getInstanceWithConfig(params.instanceId);
            
            if (!instance) {
                return {
                    success: false,
                    saved: false,
                    error: 'Instance not found'
                };
            }

            // Vérifier la config de persistance
            if (!this.shouldSaveEvent('chat', instance.persistenceConfig)) {
                return {
                    success: true,
                    saved: false,
                    reason: 'Chat history disabled in persistence config'
                };
            }

            // Construire le payload typé
            const chatData: ChatJournalPayload = {
                role: params.role === 'assistant' ? 'agent' : params.role as 'user' | 'agent' | 'tool' | 'tool_result',
                content: params.content,
                modelUsed: params.model,
                tokensUsed: params.tokensUsed,
                toolCalls: params.toolCalls?.map(tc => ({
                    id: tc.name, // Utiliser le nom comme ID si pas d'ID fourni
                    name: tc.name,
                    arguments: tc.arguments
                }))
            };

            const payload: JournalPayload = {
                type: 'chat',
                data: chatData
            };

            // Créer l'entrée
            const entry = await this.createJournalEntry(
                instance,
                'chat',
                payload,
                options
            );

            // Mettre à jour l'état de l'instance (non-bloquant)
            this.updateInstanceState(params.instanceId, {
                lastActivity: new Date()
            });

            return {
                success: true,
                saved: true,
                entryId: entry._id.toString()
            };

        } catch (error) {
            console.error('[JournalService] logChat error:', error);
            return {
                success: false,
                saved: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    /**
     * Journaliser une erreur
     * 
     * Respecte la config `saveErrors`
     */
    async logError(
        params: LogErrorParams,
        options: JournalOptions = {}
    ): Promise<JournalResult> {
        try {
            const instance = await this.getInstanceWithConfig(params.instanceId);
            
            if (!instance) {
                return {
                    success: false,
                    saved: false,
                    error: 'Instance not found'
                };
            }

            // Vérifier la config de persistance
            if (!this.shouldSaveEvent('error', instance.persistenceConfig)) {
                return {
                    success: true,
                    saved: false,
                    reason: 'Error logging disabled in persistence config'
                };
            }

            // Construire le payload typé
            const errorData: ErrorJournalPayload = {
                errorCode: params.code,
                message: params.message,
                source: 'system',
                retryable: params.recoverable ?? true,
                attempts: 1,
                stack: params.stack
            };

            const payload: JournalPayload = {
                type: 'error',
                data: errorData
            };

            // Créer l'entrée avec sévérité 'error' par défaut
            const entry = await this.createJournalEntry(
                instance,
                'error',
                payload,
                { ...options, severity: options.severity || 'error' }
            );

            // Mettre à jour le statut de l'instance si erreur non récupérable
            if (!params.recoverable) {
                await AgentInstance.findByIdAndUpdate(
                    params.instanceId,
                    { $set: { status: 'error' } }
                );
            }

            return {
                success: true,
                saved: true,
                entryId: entry._id.toString()
            };

        } catch (error) {
            console.error('[JournalService] logError error:', error);
            return {
                success: false,
                saved: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    /**
     * Journaliser un média (image, fichier)
     * 
     * Respecte la config `saveMedia` et `mediaStorage`
     * Délègue le stockage au MediaStorageService
     */
    async logMedia(
        params: LogMediaParams,
        options: JournalOptions = {}
    ): Promise<JournalResult> {
        try {
            const instance = await this.getInstanceWithConfig(params.instanceId);
            
            if (!instance) {
                return {
                    success: false,
                    saved: false,
                    error: 'Instance not found'
                };
            }

            // Vérifier la config de persistance
            if (!this.shouldSaveEvent('media', instance.persistenceConfig)) {
                return {
                    success: true,
                    saved: false,
                    reason: 'Media storage disabled in persistence config'
                };
            }

            // Sauvegarder le fichier via MediaStorageService
            const mediaPayload: MediaPayload = await this.mediaStorage.saveMedia(
                params.file,
                params.metadata,
                instance.persistenceConfig,
                {
                    userId: params.userId,
                    workflowId: params.workflowId,
                    agentInstanceId: params.instanceId
                }
            );

            // Construire le payload typé
            const mediaData: MediaJournalPayload = {
                ...mediaPayload,
                generationPrompt: params.metadata.prompt,
                generationModel: params.metadata.generatedBy
            };

            const payload: JournalPayload = {
                type: 'media',
                data: mediaData
            };

            // Créer l'entrée de journal avec le payload média
            const entry = await this.createJournalEntry(
                instance,
                'media',
                payload,
                options
            );

            // Mettre à jour l'état de l'instance
            this.updateInstanceState(params.instanceId, {
                lastActivity: new Date()
            });

            return {
                success: true,
                saved: true,
                entryId: entry._id.toString()
            };

        } catch (error) {
            console.error('[JournalService] logMedia error:', error);
            return {
                success: false,
                saved: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    /**
     * Journaliser l'exécution d'une tâche
     * 
     * Respecte la config `saveTaskExecution`
     */
    async logTask(
        params: LogTaskParams,
        options: JournalOptions = {}
    ): Promise<JournalResult> {
        try {
            const instance = await this.getInstanceWithConfig(params.instanceId);
            
            if (!instance) {
                return {
                    success: false,
                    saved: false,
                    error: 'Instance not found'
                };
            }

            // Vérifier la config de persistance
            if (!this.shouldSaveEvent('task', instance.persistenceConfig)) {
                return {
                    success: true,
                    saved: false,
                    reason: 'Task execution logging disabled in persistence config'
                };
            }

            // Construire le payload typé
            const taskData: TaskJournalPayload = {
                taskName: params.taskName,
                taskStatus: params.status,
                duration: params.duration
            };

            const payload: JournalPayload = {
                type: 'task',
                data: taskData
            };

            // Déterminer la sévérité selon le status
            let severity: JournalSeverity = 'info';
            if (params.status === 'failed') {
                severity = 'error';
            } else if (params.status === 'cancelled') {
                severity = 'warn';
            }

            // Créer l'entrée
            const entry = await this.createJournalEntry(
                instance,
                'task',
                payload,
                { ...options, severity: options.severity || severity }
            );

            // Mettre à jour l'état de l'instance
            this.updateInstanceState(params.instanceId, {
                lastActivity: new Date(),
                currentTask: params.status === 'started' ? params.taskName : undefined
            });

            return {
                success: true,
                saved: true,
                entryId: entry._id.toString()
            };

        } catch (error) {
            console.error('[JournalService] logTask error:', error);
            return {
                success: false,
                saved: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    /**
     * Journaliser un événement système
     * 
     * TOUJOURS sauvegardé (pas de condition de config)
     */
    async logSystem(
        instanceId: string,
        event: string,
        details: Record<string, unknown> = {},
        options: JournalOptions = {}
    ): Promise<JournalResult> {
        try {
            const instance = await this.getInstanceWithConfig(instanceId);
            
            if (!instance) {
                return {
                    success: false,
                    saved: false,
                    error: 'Instance not found'
                };
            }

            // Construire le payload typé
            // Mapper l'event string vers les valeurs autorisées si possible
            const systemEvent = event as SystemJournalPayload['event'];
            
            const systemData: SystemJournalPayload = {
                event: systemEvent,
                details,
                triggeredBy: 'system'
            };

            const payload: JournalPayload = {
                type: 'system',
                data: systemData
            };

            // Créer l'entrée (toujours sauvegardée)
            const entry = await this.createJournalEntry(
                instance,
                'system',
                payload,
                options
            );

            return {
                success: true,
                saved: true,
                entryId: entry._id.toString()
            };

        } catch (error) {
            console.error('[JournalService] logSystem error:', error);
            return {
                success: false,
                saved: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    // ============================================
    // MÉTHODES UTILITAIRES
    // ============================================

    /**
     * Mettre à jour le statut d'une instance
     */
    async updateInstanceStatus(
        instanceId: string,
        status: 'idle' | 'running' | 'error' | 'paused' | 'completed'
    ): Promise<boolean> {
        try {
            const result = await AgentInstance.findByIdAndUpdate(
                instanceId,
                { 
                    $set: { 
                        status,
                        'state.lastActivity': new Date()
                    } 
                }
            );
            return !!result;
        } catch (error) {
            console.error('[JournalService] updateInstanceStatus error:', error);
            return false;
        }
    }

    /**
     * Marquer le début d'une interaction
     */
    async startInteraction(instanceId: string, sessionId?: string): Promise<void> {
        await this.updateInstanceStatus(instanceId, 'running');
        await this.logSystem(instanceId, 'interaction_started', { sessionId });
    }

    /**
     * Marquer la fin d'une interaction
     */
    async endInteraction(instanceId: string, sessionId?: string): Promise<void> {
        await this.updateInstanceStatus(instanceId, 'idle');
        await this.logSystem(instanceId, 'interaction_ended', { sessionId });
    }
}

// ============================================
// SINGLETON EXPORT
// ============================================

/**
 * Instance singleton du service de journalisation
 * Utiliser cette instance pour éviter de créer plusieurs connections
 */
export const journalService = new JournalService();

export default JournalService;

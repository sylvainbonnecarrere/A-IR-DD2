/**
 * @fileoverview Types et interfaces pour la persistance des données - Jalon 1
 * 
 * Architecture de données :
 * - agent_instances : Configuration légère (chargé avec le workflow)
 * - agent_journals : Historique lourd (lazy loading)
 * - Média : Stockage flexible (BDD < 16MB, Local, Cloud)
 * 
 * @see Guides/WIP/PLAN_CORRECTIF_PERSISTANCE_WORKFLOW.md
 * @see Guides/DEV_RULES.md
 */

import { Types } from 'mongoose';

// ============================================
// CONFIGURATION DE PERSISTANCE (depuis Modal UI)
// ============================================

/**
 * Mode de stockage des médias générés
 * - database: Stockage inline en base (limité à 16MB)
 * - local: Stockage sur disque serveur (volume Docker persistant)
 * - cloud: Stockage externe S3/GCS (future implémentation)
 */
export type MediaStorageMode = 'database' | 'local' | 'cloud';

/**
 * Configuration de persistance d'un agent
 * Ces options déterminent ce qui est sauvegardé dans les journaux
 */
export interface PersistenceConfig {
    // Granularité de l'enregistrement
    saveChat: boolean;              // Sauvegarder les échanges textuels (messages user/agent/tool)
    saveChatHistory?: boolean;      // ⭐ Alias pour saveChat (compatibilité)
    saveErrors: boolean;            // Sauvegarder les logs d'erreurs
    saveTasks: boolean;             // Sauvegarder les étapes de raisonnement/tâches
    saveTaskExecution?: boolean;    // ⭐ Alias pour saveTasks (compatibilité)
    saveLinks: boolean;             // Sauvegarder les liens entre agents
    saveMedia?: boolean;            // ⭐ Activer sauvegarde des fichiers médias

    // Stratégie de stockage des médias
    mediaStorage?: 'db' | 'local' | 'cloud'; // Défaut: 'db' (inline), local (volume), cloud (S3/GCS)

    // Options avancées
    saveHistorySummary: boolean;    // Activer la compression automatique du contexte
    retentionDays?: number;         // Durée de conservation en jours (null = illimité)
}

/**
 * Configuration de persistance par défaut
 */
export const DEFAULT_PERSISTENCE_CONFIG: PersistenceConfig = {
    saveChat: true,
    saveChatHistory: true,
    saveErrors: true,
    saveTasks: false,
    saveTaskExecution: false,
    saveLinks: false,
    saveMedia: true,
    mediaStorage: 'db',
    saveHistorySummary: false,
    retentionDays: undefined
};

// ============================================
// PAYLOADS MÉDIA
// ============================================

/**
 * Métadonnées de base pour un fichier média
 */
export interface FileMetadata {
    originalName: string;
    mimeType: string;
    size: number;
    generatedBy?: string;           // ID de l'agent qui a généré le média
    prompt?: string;                // Prompt utilisé pour la génération
}

/**
 * Structure de stockage d'un média dans le journal
 * Le champ actif dépend du mode de stockage
 */
export interface MediaPayload {
    mimeType: string;
    fileName: string;
    size: number;
    storageMode: MediaStorageMode;
    
    // Mutuellement exclusifs selon le mode
    data?: Buffer;                  // Si mode = 'database' (Max 16MB)
    path?: string;                  // Si mode = 'local' (ex: storage/users/123/...)
    url?: string;                   // Si mode = 'cloud' (S3/GCS url)
    
    // Métadonnées optionnelles
    checksum?: string;              // SHA-256 du contenu pour vérification d'intégrité
    thumbnailPath?: string;         // Chemin vers miniature (images/vidéos)
    metadata?: Record<string, unknown>;
}

// ============================================
// TYPES D'ENTRÉES JOURNAL (Polymorphique)
// ============================================

/**
 * Types d'événements enregistrés dans les journaux
 */
export type JournalEntryType = 'chat' | 'error' | 'media' | 'task' | 'system';

/**
 * Niveaux de sévérité pour filtrage
 */
export type JournalSeverity = 'info' | 'warn' | 'error';

/**
 * Payload pour les entrées de type 'chat'
 */
export interface ChatJournalPayload {
    role: 'user' | 'agent' | 'tool' | 'tool_result';
    content: string;
    llmProvider?: string;
    modelUsed?: string;
    tokensUsed?: number;
    toolCalls?: {
        id: string;
        name: string;
        arguments: string;
    }[];
}

/**
 * Payload pour les entrées de type 'error'
 */
export interface ErrorJournalPayload {
    errorCode: string;
    message: string;
    source: 'llm_service' | 'tool_executor' | 'frontend' | 'system';
    retryable: boolean;
    attempts: number;
    stack?: string;
}

/**
 * Payload pour les entrées de type 'media'
 */
export interface MediaJournalPayload extends MediaPayload {
    generationPrompt?: string;
    generationModel?: string;
    generationTime?: number;        // temps de génération en ms
}

/**
 * Payload pour les entrées de type 'task'
 */
export interface TaskJournalPayload {
    taskName: string;
    taskStatus: 'started' | 'progress' | 'completed' | 'failed' | 'cancelled';
    reasoning?: string;
    stepNumber?: number;
    totalSteps?: number;
    duration?: number;              // durée en ms
}

/**
 * Payload pour les entrées de type 'system'
 */
export interface SystemJournalPayload {
    event: 'instance_created' | 'instance_started' | 'instance_paused' | 
           'instance_resumed' | 'instance_stopped' | 'config_changed' | 
           'persistence_config_updated' | 'status_changed' | 
           'interaction_started' | 'interaction_ended';
    details?: Record<string, unknown>;
    triggeredBy?: string;           // userId ou 'system'
}

/**
 * Union des payloads selon le type
 */
export type JournalPayload = 
    | { type: 'chat'; data: ChatJournalPayload }
    | { type: 'error'; data: ErrorJournalPayload }
    | { type: 'media'; data: MediaJournalPayload }
    | { type: 'task'; data: TaskJournalPayload }
    | { type: 'system'; data: SystemJournalPayload };

// ============================================
// INTERFACES POUR LES MODÈLES MONGOOSE
// ============================================

/**
 * État d'exécution d'une instance d'agent
 */
export type AgentInstanceStatus = 'idle' | 'running' | 'error' | 'paused' | 'completed';

/**
 * État runtime court terme d'un agent
 */
export interface AgentRuntimeState {
    memory?: string;                // Mémoire contextuelle courte
    variables?: Record<string, unknown>; // Variables actives
    lastActivity?: Date;
    currentTask?: string;
}

/**
 * Configuration LLM d'une instance
 */
export interface AgentInstanceConfiguration {
    llmProvider: string;
    llmModel: string;
    temperature?: number;
    maxTokens?: number;
    systemPrompt?: string;
    tools?: {
        name: string;
        enabled: boolean;
        parameters?: Record<string, unknown>;
    }[];
    historyConfig?: {
        maxMessages?: number;
        summarizeAfter?: number;
    };
    outputConfig?: Record<string, unknown>;
}

/**
 * Document AgentInstance léger (nouvelle architecture)
 */
export interface IAgentInstanceLean {
    _id: Types.ObjectId;
    workflowId: Types.ObjectId;
    userId: Types.ObjectId;
    prototypeId?: Types.ObjectId;
    
    // Identité
    name: string;
    role: string;
    robotId: string;
    
    // Configuration
    configuration: AgentInstanceConfiguration;
    persistenceConfig: PersistenceConfig;
    
    // État runtime
    state: AgentRuntimeState;
    status: AgentInstanceStatus;
    
    // Métadonnées
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Document AgentJournal
 */
export interface IAgentJournal {
    _id: Types.ObjectId;
    agentInstanceId: Types.ObjectId;
    workflowId: Types.ObjectId;
    
    timestamp: Date;
    type: JournalEntryType;
    severity: JournalSeverity;
    payload: unknown;               // Contenu flexible selon le type
    
    // Indexation additionnelle
    sessionId?: string;             // Pour grouper les entrées d'une session
}

// ============================================
// DTOs POUR LES REQUÊTES API
// ============================================

/**
 * Body de création d'instance (POST /api/workflows/:id/instances)
 */
export interface CreateInstanceRequestBody {
    agentConfig: {
        name: string;
        role: string;
        prototypeId?: string;
        configuration: AgentInstanceConfiguration;
    };
    persistenceOptions: Partial<PersistenceConfig>;
    position: { x: number; y: number };
}

/**
 * Réponse de création d'instance
 */
export interface CreateInstanceResponse {
    instance: {
        _id: string;
        name: string;
        role: string;
        status: AgentInstanceStatus;
        persistenceConfig: PersistenceConfig;
    };
    node: {
        _id: string;
        instanceId: string;
        position: { x: number; y: number };
    };
}

/**
 * Paramètres de pagination pour les journaux
 */
export interface JournalQueryParams {
    type?: JournalEntryType;
    severity?: JournalSeverity;
    page?: number;
    limit?: number;
    startDate?: string;
    endDate?: string;
}

/**
 * Réponse paginée des journaux
 */
export interface JournalPaginatedResponse {
    data: IAgentJournal[];
    meta: {
        total: number;
        page: number;
        pages: number;
        limit: number;
    };
}

// ============================================
// CONSTANTES DE VALIDATION
// ============================================

/**
 * Taille maximale pour stockage inline en base (MongoDB BSON limit)
 */
export const MAX_DATABASE_MEDIA_SIZE = 16 * 1024 * 1024; // 16 MB

/**
 * Extensions de fichiers média autorisées
 */
export const ALLOWED_MEDIA_EXTENSIONS = [
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg',
    'mp3', 'wav', 'ogg',
    'mp4', 'webm',
    'pdf', 'json', 'txt', 'md'
] as const;

/**
 * MIME types autorisés
 */
export const ALLOWED_MIME_TYPES = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
    'audio/mpeg', 'audio/wav', 'audio/ogg',
    'video/mp4', 'video/webm',
    'application/pdf', 'application/json', 'text/plain', 'text/markdown'
] as const;

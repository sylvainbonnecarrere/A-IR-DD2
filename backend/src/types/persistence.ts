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
export type ProductMediaStorageType = 'db' | 'workspace' | 'cloud';
export type PersistedMediaStorageType = 'db' | 'local' | 'cloud';

export function normalizePersistedMediaStorage(
    value?: ProductMediaStorageType | PersistedMediaStorageType | MediaStorageMode | null
): ProductMediaStorageType {
    switch (value) {
        case 'workspace':
        case 'cloud':
        case 'db':
            return value;
        case 'local':
            return 'workspace';
        case 'database':
        default:
            return 'db';
    }
}

export function denormalizeMediaStorageForPersistence(
    value?: ProductMediaStorageType | PersistedMediaStorageType | MediaStorageMode | null
): PersistedMediaStorageType {
    const normalized = normalizePersistedMediaStorage(value);

    switch (normalized) {
        case 'workspace':
            return 'local';
        case 'cloud':
            return 'cloud';
        case 'db':
        default:
            return 'db';
    }
}

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
    allowWorkspaceWrite?: boolean;  // ⭐ Autorise aussi une publication workspace si demandée

    // Stratégie de stockage des médias
    mediaStorage?: ProductMediaStorageType | PersistedMediaStorageType; // Défaut: 'db' (inline), local/workspace, cloud (S3/GCS)
    cloudConnectionProfileId?: string; // Référence vers un profil cloud sécurisé

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
    allowWorkspaceWrite: true,
    mediaStorage: 'db',
    saveHistorySummary: false,
    retentionDays: undefined
};

export function resolveAllowWorkspaceWrite(
    saveMedia: boolean,
    mediaStorage?: ProductMediaStorageType | PersistedMediaStorageType | MediaStorageMode | null,
    explicitValue?: boolean | null,
): boolean {
    if (!saveMedia) {
        return false;
    }

    if (normalizePersistedMediaStorage(mediaStorage) === 'workspace') {
        return true;
    }

    return explicitValue ?? true;
}

export function normalizePersistenceConfigForPersistence(
    config?: Partial<PersistenceConfig> | null,
): PersistenceConfig {
    const merged = {
        ...DEFAULT_PERSISTENCE_CONFIG,
        ...(config || {}),
    };

    const saveMedia = merged.saveMedia ?? DEFAULT_PERSISTENCE_CONFIG.saveMedia ?? false;
    const mediaStorage = denormalizeMediaStorageForPersistence(merged.mediaStorage);

    return {
        ...merged,
        saveMedia,
        mediaStorage,
        allowWorkspaceWrite: resolveAllowWorkspaceWrite(saveMedia, mediaStorage, merged.allowWorkspaceWrite),
    };
}

export function normalizePersistenceConfigForProduct(
    config?: Partial<PersistenceConfig> | null,
): PersistenceConfig {
    const normalized = normalizePersistenceConfigForPersistence(config);

    return {
        ...normalized,
        mediaStorage: normalizePersistedMediaStorage(normalized.mediaStorage),
        allowWorkspaceWrite: resolveAllowWorkspaceWrite(
            normalized.saveMedia ?? false,
            normalized.mediaStorage,
            normalized.allowWorkspaceWrite,
        ),
    };
}

export function sanitizePersistenceConfigForInstanceEgress(
    config?: Partial<PersistenceConfig> | null,
): PersistenceConfig {
    const normalized = normalizePersistenceConfigForProduct(config) as PersistenceConfig & {
        cloudStorageConfig?: unknown;
    };
    const { cloudStorageConfig: _cloudStorageConfig, ...sanitized } = normalized;

    return sanitized;
}

export function summarizePersistenceConfigBoundary(
    config?: Partial<PersistenceConfig> | null,
) {
    const normalized = normalizePersistenceConfigForProduct(config);
    const rawCloudConfig = (config as any)?.cloudStorageConfig;

    return {
        saveChat: normalized.saveChat,
        saveErrors: normalized.saveErrors,
        saveMedia: normalized.saveMedia,
        mediaStorage: normalized.mediaStorage,
        allowWorkspaceWrite: normalized.allowWorkspaceWrite,
        cloudConnectionProfileId: (config as any)?.cloudConnectionProfileId ?? null,
        hasCloudStorageConfig: !!rawCloudConfig,
        cloudProvider: rawCloudConfig?.provider ?? null,
    };
}

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
export type JournalEntryType = 'chat' | 'error' | 'media' | 'task' | 'system' | 'tool_invocation';

/**
 * Niveaux de sévérité pour filtrage
 */
export type JournalSeverity = 'info' | 'warn' | 'error';

export interface JournalCorrelationIds {
    messageId?: string;
    toolCallId?: string;
    executionId?: string;
}

/**
 * Payload pour les entrées de type 'chat'
 * ⭐ FIX QA: Added imageBase64, mimeType, fileName for media persistence in chat
 */
export interface ChatJournalPayload extends JournalCorrelationIds {
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
    // ⭐ FIX QA: Support images inline dans les messages chat
    imageBase64?: string;    // Image data en base64
    mimeType?: string;       // ex: image/png, image/jpeg
    fileName?: string;       // Nom original du fichier
}

/**
 * Payload pour les entrées de type 'error'
 */
export interface ErrorJournalPayload extends JournalCorrelationIds {
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
export interface MediaJournalPayload extends MediaPayload, JournalCorrelationIds {
    generationPrompt?: string;
    generationModel?: string;
    generationTime?: number;        // temps de génération en ms
}

/**
 * Payload pour les entrées de type 'task'
 */
export interface TaskJournalPayload extends JournalCorrelationIds {
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
export interface SystemJournalPayload extends JournalCorrelationIds {
    event: 'instance_created' | 'instance_started' | 'instance_paused' | 
           'instance_resumed' | 'instance_stopped' | 'config_changed' | 
           'persistence_config_updated' | 'status_changed' | 
           'interaction_started' | 'interaction_ended';
    details?: Record<string, unknown>;
    triggeredBy?: string;           // userId ou 'system'
}

interface ToolInvocationJournalPayloadBase extends JournalCorrelationIds {
    toolCallId: string;
    toolName: string;
    toolId?: string;
    functionId?: string;
}

export interface ToolInvocationStartedJournalPayload extends ToolInvocationJournalPayloadBase {
    phase: 'started';
    executionId?: string;
}

export interface ToolInvocationSettledJournalPayload extends ToolInvocationJournalPayloadBase {
    phase: 'completed' | 'failed';
    executionId: string;
}

/**
 * Projection conversationnelle légère d'un appel outil.
 * La vérité d'exécution détaillée reste dans user_tool_runs.
 */
export type ToolInvocationJournalPayload =
    | ToolInvocationStartedJournalPayload
    | ToolInvocationSettledJournalPayload;

/**
 * Union des payloads selon le type persiste en base.
 */
export type JournalPayload = 
    | ChatJournalPayload
    | ErrorJournalPayload
    | MediaJournalPayload
    | TaskJournalPayload
    | SystemJournalPayload
    | ToolInvocationJournalPayload;

export interface JournalPayloadByType {
    chat: ChatJournalPayload;
    error: ErrorJournalPayload;
    media: MediaJournalPayload;
    task: TaskJournalPayload;
    system: SystemJournalPayload;
    tool_invocation: ToolInvocationJournalPayload;
}

// ============================================
// INTERFACES POUR LES MODÈLES MONGOOSE
// ============================================

/**
 * État d'exécution d'une instance d'agent
 */
// ✅ ÉTAPE 1: Harmonisé avec le modèle AgentInstance.model.ts (enum: running, completed, failed, stopped)
export type AgentInstanceStatus = 'running' | 'completed' | 'failed' | 'stopped';

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
        // ✅ ÉTAPE 1: Ajouter configuration complète pour le frontend
        configuration_json?: {
            llmProvider: string;
            llmModel: string;
            systemPrompt: string;
            role: string;
            tools: any[];
            capabilities: string[];
            outputConfig?: any;
            historyConfig?: any;
        };
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

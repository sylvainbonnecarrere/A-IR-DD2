/**
 * Agent Instance Zod Schemas - ÉTAPE 1.6 Persistence Contract
 * 
 * Schémas de validation pour les instances d'exécution d'agents.
 * Contenu polymorphe: chat, image, video, error
 */

import { z } from 'zod';
import { WebSearchParamsSchema } from './web-search-params.schema';

// ============================================
// TYPES DE CONTENU POLYMORPHE
// ============================================

/**
 * Contenu Chat - Message de conversation
 */
export const AgentInstanceChatContentSchema = z.object({
    type: z.literal('chat'),
    role: z.enum(['user', 'agent', 'tool']),
    message: z.string(),
    timestamp: z.date(),
    metadata: z.object({
        llmProvider: z.string().optional(),
        modelUsed: z.string().optional(),
        tokensUsed: z.number().optional()
    }).optional()
});

/**
 * Contenu Image - Image générée
 */
export const AgentInstanceImageContentSchema = z.object({
    type: z.literal('image'),
    mediaId: z.string().uuid('mediaId doit être un UUID valide'),
    prompt: z.string(),
    url: z.string().url('URL invalide'),
    timestamp: z.date(),
    metadata: z.object({
        model: z.string(),
        size: z.string()
    })
});

/**
 * Contenu Video - Vidéo générée
 */
export const AgentInstanceVideoContentSchema = z.object({
    type: z.literal('video'),
    mediaId: z.string().uuid('mediaId doit être un UUID valide'),
    prompt: z.string(),
    duration: z.number().min(0, 'La durée doit être positive'),
    timestamp: z.date(),
    metadata: z.object({
        model: z.string(),
        fps: z.number().min(1).max(120),
        resolution: z.string()
    })
});

/**
 * Sous-types d'erreurs possibles
 */
export const ErrorSubTypeEnum = z.enum([
    'llm_timeout',
    'api_rate_limit',
    'invalid_tool_call',
    'authentication_error',
    'network_error',
    'validation_error',
    'unknown_error'
]);

/**
 * Sources d'erreurs possibles
 */
export const ErrorSourceEnum = z.enum([
    'llm_service',
    'tool_executor',
    'frontend'
]);

/**
 * Contenu Error - Erreur d'exécution
 */
export const AgentInstanceErrorContentSchema = z.object({
    type: z.literal('error'),
    subType: ErrorSubTypeEnum,
    message: z.string(),
    timestamp: z.date(),
    metadata: z.object({
        errorCode: z.string().optional(),
        source: ErrorSourceEnum,
        retryable: z.boolean(),
        attempts: z.number().min(0)
    })
});

/**
 * Union de tous les types de contenu (discriminated union)
 */
export const AgentInstanceContentSchema = z.discriminatedUnion('type', [
    AgentInstanceChatContentSchema,
    AgentInstanceImageContentSchema,
    AgentInstanceVideoContentSchema,
    AgentInstanceErrorContentSchema
]);

// ============================================
// SCHÉMAS PRINCIPAUX
// ============================================

/**
 * Statuts d'exécution possibles
 */
export const ExecutionStatusEnum = z.enum([
    'running',
    'completed',
    'failed',
    'stopped'
]);

/**
 * Métriques d'exécution
 */
export const AgentInstanceMetricsSchema = z.object({
    totalTokens: z.number().min(0).default(0),
    totalErrors: z.number().min(0).default(0),
    totalMediaGenerated: z.number().min(0).default(0),
    callCount: z.number().min(0).default(0)
});

/**
 * Schéma pour créer une nouvelle instance d'agent
 */
export const AgentInstanceCreateSchema = z.object({
    agentId: z.string(),
    workflowId: z.string(),
    executionId: z.string(),
    status: ExecutionStatusEnum.default('running'),
    content: z.array(AgentInstanceContentSchema).default([]),
    webSearchParams: WebSearchParamsSchema.optional(),
    userNotes: z.string().max(2000).optional(),
    tags: z.array(z.string().max(50)).optional()
});

/**
 * Schéma pour mise à jour d'une instance (partielle)
 */
export const AgentInstanceUpdateSchema = z.object({
    status: ExecutionStatusEnum.optional(),
    content: z.array(AgentInstanceContentSchema).optional(),
    webSearchParams: WebSearchParamsSchema.optional(),
    completedAt: z.date().optional(),
    duration: z.number().min(0).optional(),
    userNotes: z.string().max(2000).optional(),
    tags: z.array(z.string().max(50)).optional(),
    metrics: AgentInstanceMetricsSchema.partial().optional()
});

/**
 * Schéma pour ajouter du contenu à une instance existante
 */
export const AgentInstanceAddContentSchema = z.object({
    content: AgentInstanceContentSchema
});

/**
 * Schéma complet d'une instance d'agent (avec métadonnées MongoDB)
 */
export const AgentInstanceFullSchema = AgentInstanceCreateSchema.extend({
    _id: z.string(),
    userId: z.string(),
    prototypeId: z.string().optional(),
    startedAt: z.date(),
    completedAt: z.date().optional(),
    duration: z.number().optional(),
    metrics: AgentInstanceMetricsSchema.optional(),
    // Snapshot config (copie du prototype)
    name: z.string(),
    role: z.string(),
    systemPrompt: z.string(),
    llmProvider: z.string(),
    llmModel: z.string(),
    capabilities: z.array(z.string()),
    webSearchParams: WebSearchParamsSchema.optional(),
    robotId: z.string(),
    // Canvas properties
    position: z.object({
        x: z.number(),
        y: z.number()
    }),
    isMinimized: z.boolean(),
    isMaximized: z.boolean(),
    zIndex: z.number(),
    // Timestamps
    createdAt: z.date(),
    updatedAt: z.date()
});

// ============================================
// TYPES EXPORTÉS
// ============================================

export type IAgentInstanceChatContent = z.infer<typeof AgentInstanceChatContentSchema>;
export type IAgentInstanceImageContent = z.infer<typeof AgentInstanceImageContentSchema>;
export type IAgentInstanceVideoContent = z.infer<typeof AgentInstanceVideoContentSchema>;
export type IAgentInstanceErrorContent = z.infer<typeof AgentInstanceErrorContentSchema>;
export type IAgentInstanceContent = z.infer<typeof AgentInstanceContentSchema>;

export type IAgentInstanceCreate = z.infer<typeof AgentInstanceCreateSchema>;
export type IAgentInstanceUpdate = z.infer<typeof AgentInstanceUpdateSchema>;
export type IAgentInstanceFull = z.infer<typeof AgentInstanceFullSchema>;
export type IAgentInstanceMetrics = z.infer<typeof AgentInstanceMetricsSchema>;

export type IExecutionStatus = z.infer<typeof ExecutionStatusEnum>;
export type IErrorSubType = z.infer<typeof ErrorSubTypeEnum>;
export type IErrorSource = z.infer<typeof ErrorSourceEnum>;

// ============================================
// FONCTIONS DE VALIDATION
// ============================================

/**
 * Valide les données de création d'une instance
 */
export function validateAgentInstanceCreate(data: unknown): IAgentInstanceCreate {
    return AgentInstanceCreateSchema.parse(data);
}

/**
 * Valide les données de mise à jour d'une instance
 */
export function validateAgentInstanceUpdate(data: unknown): IAgentInstanceUpdate {
    return AgentInstanceUpdateSchema.parse(data);
}

/**
 * Valide un contenu à ajouter
 */
export function validateAgentInstanceContent(data: unknown): IAgentInstanceContent {
    return AgentInstanceContentSchema.parse(data);
}

/**
 * Validation safe (ne throw pas, retourne un résultat)
 */
export function safeValidateAgentInstanceCreate(data: unknown) {
    return AgentInstanceCreateSchema.safeParse(data);
}

export function safeValidateAgentInstanceUpdate(data: unknown) {
    return AgentInstanceUpdateSchema.safeParse(data);
}

export function safeValidateAgentInstanceContent(data: unknown) {
    return AgentInstanceContentSchema.safeParse(data);
}

// ============================================
// HELPERS
// ============================================

/**
 * Crée un contenu chat formaté
 */
export function createChatContent(
    role: 'user' | 'agent' | 'tool',
    message: string,
    metadata?: { llmProvider?: string; modelUsed?: string; tokensUsed?: number }
): IAgentInstanceChatContent {
    return {
        type: 'chat',
        role,
        message,
        timestamp: new Date(),
        metadata
    };
}

/**
 * Crée un contenu erreur formaté
 */
export function createErrorContent(
    subType: IErrorSubType,
    message: string,
    source: IErrorSource,
    retryable: boolean = false,
    attempts: number = 1,
    errorCode?: string
): IAgentInstanceErrorContent {
    return {
        type: 'error',
        subType,
        message,
        timestamp: new Date(),
        metadata: {
            errorCode,
            source,
            retryable,
            attempts
        }
    };
}

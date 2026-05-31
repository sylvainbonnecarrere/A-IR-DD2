/**
 * Agent Zod Schemas - ÉTAPE 1.6 Persistence Contract
 * 
 * Schémas de validation pour les prototypes d'agents.
 * Ces schémas garantissent la cohérence des données avant persistance.
 */

import { z } from 'zod';
import { CanonicalRobotIdEnum } from '../types/robotIds';
import { WebSearchParamsSchema } from './web-search-params.schema';

// ============================================
// SOUS-SCHÉMAS
// ============================================

/**
 * Position sur le canvas (x, y)
 */
export const AgentPositionSchema = z.object({
    x: z.number().min(0).describe('Pixel position X'),
    y: z.number().min(0).describe('Pixel position Y')
});

/**
 * Outil disponible pour l'agent
 */
export const AgentToolSchema = z.object({
    name: z.string().min(1),
    description: z.string(),
    inputSchema: z.record(z.any())
});

/**
 * Configuration d'historique de conversation
 */
export const AgentHistoryConfigSchema = z.object({
    maxMessages: z.number().optional(),
    includeSystemPrompt: z.boolean().optional(),
    summarizeAfter: z.number().optional()
}).optional();

/**
 * Configuration de sortie
 */
export const AgentOutputConfigSchema = z.object({
    format: z.enum(['text', 'json', 'markdown']).optional(),
    maxTokens: z.number().optional(),
    temperature: z.number().min(0).max(2).optional()
}).optional();

// ============================================
// SCHÉMAS PRINCIPAUX
// ============================================

/**
 * Robots créateurs autorisés (V2 Architecture)
 */
export const RobotCreatorEnum = CanonicalRobotIdEnum;

/**
 * Schéma pour créer un nouvel agent prototype
 */
export const AgentCreateSchema = z.object({
    name: z.string()
        .min(1, 'Le nom est requis')
        .max(100, 'Le nom ne peut pas dépasser 100 caractères'),
    role: z.string()
        .min(1, 'Le rôle est requis')
        .max(200, 'Le rôle ne peut pas dépasser 200 caractères'),
    systemPrompt: z.string()
        .min(1, 'Le prompt système est requis'),
    llmProvider: z.string()
        .min(1, 'Le provider LLM est requis'),
    llmModel: z.string()
        .min(1, 'Le modèle LLM est requis'),
    capabilities: z.array(z.string()).optional().default([]),
    historyConfig: AgentHistoryConfigSchema,
    webSearchParams: WebSearchParamsSchema.optional(),
    tools: z.array(AgentToolSchema).optional().default([]),
    outputConfig: AgentOutputConfigSchema,
    position: AgentPositionSchema.optional().default({ x: 0, y: 0 }),
    robotId: RobotCreatorEnum
});

/**
 * Schéma pour mise à jour partielle d'un agent
 */
export const AgentUpdateSchema = AgentCreateSchema.partial();

/**
 * Schéma complet d'un agent (avec métadonnées MongoDB)
 */
export const AgentFullSchema = AgentCreateSchema.extend({
    _id: z.string(),
    userId: z.string(),
    workflowId: z.string().optional(),
    isPrototype: z.boolean().default(true),
    createdAt: z.date(),
    updatedAt: z.date()
});

// ============================================
// TYPES EXPORTÉS
// ============================================

export type IAgentCreate = z.infer<typeof AgentCreateSchema>;
export type IAgentUpdate = z.infer<typeof AgentUpdateSchema>;
export type IAgentFull = z.infer<typeof AgentFullSchema>;
export type IAgentPosition = z.infer<typeof AgentPositionSchema>;
export type IAgentTool = z.infer<typeof AgentToolSchema>;
export type IRobotCreator = z.infer<typeof RobotCreatorEnum>;

// ============================================
// FONCTIONS DE VALIDATION
// ============================================

/**
 * Valide les données de création d'un agent
 */
export function validateAgentCreate(data: unknown): IAgentCreate {
    return AgentCreateSchema.parse(data);
}

/**
 * Valide les données de mise à jour d'un agent
 */
export function validateAgentUpdate(data: unknown): IAgentUpdate {
    return AgentUpdateSchema.parse(data);
}

/**
 * Valide un agent complet
 */
export function validateAgentFull(data: unknown): IAgentFull {
    return AgentFullSchema.parse(data);
}

/**
 * Validation safe (ne throw pas, retourne un résultat)
 */
export function safeValidateAgentCreate(data: unknown) {
    return AgentCreateSchema.safeParse(data);
}

export function safeValidateAgentUpdate(data: unknown) {
    return AgentUpdateSchema.safeParse(data);
}

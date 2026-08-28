/**
 * Workflow Zod Schemas - ÉTAPE 1.6 Persistence Contract
 * 
 * Schémas de validation pour les workflows.
 * Contrainte J4.4: Un seul workflow par défaut par utilisateur.
 */

import { z } from 'zod';

// ============================================
// SOUS-SCHÉMAS
// ============================================

/**
 * État du canvas (zoom, pan)
 */
export const CanvasStateSchema = z.object({
    zoom: z.number().min(0.1).max(5).default(1),
    panX: z.number().default(0),
    panY: z.number().default(0)
});

/**
 * Nœud de workflow (agent sur canvas)
 */
export const WorkflowNodeSchema = z.object({
    id: z.string(),
    type: z.string(),
    position: z.object({
        x: z.number(),
        y: z.number()
    }),
    data: z.record(z.string(),z.any())
});

/**
 * Connexion entre nœuds
 */
export const WorkflowEdgeSchema = z.object({
    id: z.string(),
    source: z.string(),
    target: z.string(),
    sourceHandle: z.string().optional(),
    targetHandle: z.string().optional(),
    type: z.string().optional(),
    data: z.record(z.string(), z.any()).optional()
});

// ============================================
// SCHÉMAS PRINCIPAUX
// ============================================

/**
 * Schéma pour créer un nouveau workflow
 */
export const WorkflowCreateSchema = z.object({
    name: z.string()
        .min(1, 'Le nom est requis')
        .max(100, 'Le nom ne peut pas dépasser 100 caractères'),
    description: z.string()
        .max(500, 'La description ne peut pas dépasser 500 caractères')
        .optional(),
    isActive: z.boolean().default(false),
    isDefault: z.boolean().default(false),
    canvasState: CanvasStateSchema.optional().default({
        zoom: 1,
        panX: 0,
        panY: 0
    })
});

/**
 * Schéma pour mise à jour partielle d'un workflow
 */
export const WorkflowUpdateSchema = z.object({
    name: z.string()
        .min(1)
        .max(100)
        .optional(),
    description: z.string()
        .max(500)
        .optional(),
    isActive: z.boolean().optional(),
    isDefault: z.boolean().optional(),
    canvasState: CanvasStateSchema.partial().optional(),
    isDirty: z.boolean().optional(),
    lastSavedAt: z.date().optional()
});

/**
 * Schéma pour sauvegarder l'état complet du workflow (MANUAL SAVE)
 */
export const WorkflowSaveSchema = z.object({
    nodes: z.array(WorkflowNodeSchema).optional(),
    edges: z.array(WorkflowEdgeSchema).optional(),
    canvasState: CanvasStateSchema.optional(),
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional()
});

/**
 * Schéma complet d'un workflow (avec métadonnées MongoDB)
 */
export const WorkflowFullSchema = WorkflowCreateSchema.extend({
    _id: z.string(),
    userId: z.string(),
    lastSavedAt: z.date().optional(),
    isDirty: z.boolean().default(false),
    lastEditedBy: z.string().optional(),
    createdAt: z.date(),
    updatedAt: z.date()
});

// ============================================
// TYPES EXPORTÉS
// ============================================

export type ICanvasState = z.infer<typeof CanvasStateSchema>;
export type IWorkflowNode = z.infer<typeof WorkflowNodeSchema>;
export type IWorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;
export type IWorkflowCreate = z.infer<typeof WorkflowCreateSchema>;
export type IWorkflowUpdate = z.infer<typeof WorkflowUpdateSchema>;
export type IWorkflowSave = z.infer<typeof WorkflowSaveSchema>;
export type IWorkflowFull = z.infer<typeof WorkflowFullSchema>;

// ============================================
// FONCTIONS DE VALIDATION
// ============================================

/**
 * Valide les données de création d'un workflow
 */
export function validateWorkflowCreate(data: unknown): IWorkflowCreate {
    return WorkflowCreateSchema.parse(data);
}

/**
 * Valide les données de mise à jour d'un workflow
 */
export function validateWorkflowUpdate(data: unknown): IWorkflowUpdate {
    return WorkflowUpdateSchema.parse(data);
}

/**
 * Valide les données de sauvegarde (Manual Save)
 */
export function validateWorkflowSave(data: unknown): IWorkflowSave {
    return WorkflowSaveSchema.parse(data);
}

/**
 * Validation safe (ne throw pas, retourne un résultat)
 */
export function safeValidateWorkflowCreate(data: unknown) {
    return WorkflowCreateSchema.safeParse(data);
}

export function safeValidateWorkflowUpdate(data: unknown) {
    return WorkflowUpdateSchema.safeParse(data);
}

export function safeValidateWorkflowSave(data: unknown) {
    return WorkflowSaveSchema.safeParse(data);
}

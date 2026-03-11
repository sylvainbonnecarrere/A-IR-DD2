/**
 * @file UserFunction.model.ts
 * @description Registre centralisé de toutes les fonctions/tools disponibles pour les agents IA.
 *
 * ARCHITECTURE (Tools V2):
 * - Source de vérité unique pour les fonctions natives ET custom
 * - Les fonctions natives ont userId=null, isReadonly=true, origin='native'
 * - Les fonctions custom sont scopées par userId + workflowId
 * - Le champ isEnabled contrôle la visibilité dans Archi/Prototypage et Bos/Workflow
 *
 * SOLID:
 * - S: Single Responsibility — gestion des définitions de fonctions uniquement
 * - O: Open/Closed — extensible par tags, dependencies, sans modifier l'interface
 * - L: Substituable dans FunctionRegistry (IUserFunction)
 * - I: Interface séparée des types d'exécution (IToolExecutor)
 * - D: Consommé via interfaces, jamais directement depuis ToolExecutor
 */

import mongoose, { Document, Schema } from 'mongoose';

// ============================================
// TYPES
// ============================================

export type FunctionLanguage = 'typescript' | 'python';
export type FunctionOrigin = 'native' | 'custom';

// ============================================
// INTERFACE PRINCIPALE
// ============================================

export interface IUserFunction extends Document {
    // --- Identification ---
    name: string;                           // Nom technique unique (snake_case_py ou camelCase)
    displayName?: string;                   // Nom affichable dans l'UI
    description: string;
    language: FunctionLanguage;
    origin: FunctionOrigin;                 // 'native' = readonly, 'custom' = éditable
    tags: string[];

    // --- Scoping ---
    userId?: mongoose.Types.ObjectId | null; // null pour les natifs (partagés)
    workflowId?: mongoose.Types.ObjectId | null; // null si scopé globalement à l'user

    // --- Schémas I/O ---
    inputSchema: object;                    // JSON Schema v7
    outputSchema: object;                   // JSON Schema v7

    // --- Code source ---
    codePath?: string;                      // Chemin relatif depuis WORKSPACE_ROOT (fonctions custom)
    codeInline?: string;                    // Code inline pour les natifs ou petites fonctions

    // --- Dépendances ---
    dependencies?: {
        python?: string[];                  // ex: ["httpx==0.27.0", "pandas>=2.0"]
        npm?: string[];                     // ex: ["lodash@4.17.21"]
    };

    // --- État ---
    isEnabled: boolean;                     // Toggle: visible dans prototypage/workflow
    isReadonly: boolean;                    // true pour les natifs

    // --- Métadonnées ---
    version: number;
    createdAt: Date;
    updatedAt: Date;
}

// ============================================
// SCHEMA MONGOOSE
// ============================================

const UserFunctionSchema = new Schema<IUserFunction>(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            minlength: 1,
            maxlength: 100
        },
        displayName: {
            type: String,
            trim: true,
            maxlength: 150
        },
        description: {
            type: String,
            required: true,
            trim: true,
            maxlength: 1000
        },
        language: {
            type: String,
            required: true,
            enum: ['typescript', 'python']
        },
        origin: {
            type: String,
            required: true,
            enum: ['native', 'custom'],
            default: 'custom'
        },
        tags: [{
            type: String,
            trim: true,
            maxlength: 50
        }],

        // Scoping (null = partagé / global)
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null
        },
        workflowId: {
            type: Schema.Types.ObjectId,
            ref: 'Workflow',
            default: null
        },

        // Schémas I/O
        inputSchema: {
            type: Schema.Types.Mixed,
            required: true,
            default: () => ({ type: 'object', properties: {}, required: [] })
        },
        outputSchema: {
            type: Schema.Types.Mixed,
            required: true,
            default: () => ({ type: 'object', properties: {} })
        },

        // Code source
        codePath: {
            type: String,
            default: undefined
        },
        codeInline: {
            type: String,
            maxlength: 50000 // 50KB max inline
        },

        // Dépendances
        dependencies: {
            python: [{ type: String }],
            npm: [{ type: String }],
            _id: false
        },

        // État
        isEnabled: {
            type: Boolean,
            default: true
        },
        isReadonly: {
            type: Boolean,
            default: false
        },

        // Versioning
        version: {
            type: Number,
            default: 1
        }
    },
    {
        timestamps: true,
        collection: 'user_functions'
    }
);

// ============================================
// INDEX
// ============================================

// Requête principale Phil/Library : fonctions actives d'un user + workflow
UserFunctionSchema.index({ userId: 1, workflowId: 1, isEnabled: 1 });
// Fonctions natives actives (partagées entre tous les users)
UserFunctionSchema.index({ origin: 1, isEnabled: 1 });
// Unicité du nom par user (les natifs ont userId=null)
UserFunctionSchema.index(
    { name: 1, userId: 1 },
    { unique: true, sparse: false }
);
// Langue pour filtrage
UserFunctionSchema.index({ language: 1, userId: 1 });

// ============================================
// EXPORT
// ============================================

export const UserFunction = mongoose.model<IUserFunction>('UserFunction', UserFunctionSchema);

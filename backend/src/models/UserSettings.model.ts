/**
 * @file UserSettings.model.ts
 * @description User settings persistence (J4.4 - Simplified)
 * @domain Design Domain - User Preferences
 * 
 * ARCHITECTURE:
 * - One document per user (userId is unique key)
 * - Stores ONLY user preferences (language, theme, saveMode)
 * - LLM API keys are stored ONLY in LLMConfig collection
 * 
 * MIGRATION NOTE (J4.4):
 * - llmConfigs field REMOVED - was causing duplicate storage
 * - All API key operations now go through /api/llm-configs
 * - This model is preferences-only
 * 
 * SOLID PRINCIPLES:
 * - S: Single Responsibility (only user preferences)
 * - O: Open/Closed (easy to add new preference fields)
 */

import mongoose, { Schema, Document } from 'mongoose';

/**
 * User Preferences (language, theme, saveMode, etc.)
 */
export interface UserPreferences {
    language: 'fr' | 'en' | 'de' | 'es' | 'pt';
    theme?: 'dark' | 'light';
    saveMode?: 'auto' | 'manual';
    // ⭐ Tools V2: préférences agent codeur (page Phil/Functions)
    codingAgent?: {
        llmProvider?: string;
        llmModel?: string;
        speciality?: 'typescript' | 'python';
        tsCodingSystemPrompt?: string;
        pyCodingSystemPrompt?: string;
    };
}

/**
 * Complete UserSettings document (J4.4 - Simplified)
 * NOTE: llmConfigs removed - use LLMConfig collection instead
 */
export interface IUserSettings extends Document {
    userId: mongoose.Types.ObjectId;

    // User Preferences only
    preferences: UserPreferences;

    // Legacy compatibility only.
    // J4: Workspace.logicalRoot/runtimeRoots becomes the target authority for persistent paths.
    // This field remains transitional for read/write compatibility until legacy consumers are removed.
    functionPaths?: {
        workflowId: string;
        pythonPath: string;
        tsPath: string;
    }[];

    // Sync tracking
    lastSync?: Date;

    // Metadata
    createdAt: Date;
    updatedAt: Date;
    version: number;
}

const userSettingsSchema = new Schema(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true
        },

        // User Preferences only (J4.4: llmConfigs removed)
        preferences: {
            language: {
                type: String,
                enum: ['fr', 'en', 'de', 'es', 'pt'],
                default: 'fr'
            },
            theme: {
                type: String,
                enum: ['dark', 'light'],
                default: 'dark'
            },
            saveMode: {
                type: String,
                enum: ['auto', 'manual'],
                default: 'manual'
            }
        },

        // Last sync timestamp
        lastSync: {
            type: Date,
            default: null
        },

        // Legacy compatibility only. Do not treat this mapping as the target source of truth.
        functionPaths: [{
            workflowId: { type: String, required: true },
            pythonPath: { type: String, required: true },
            tsPath: { type: String, required: true },
            _id: false
        }],

        // Versioning for conflict resolution
        version: {
            type: Number,
            default: 1
        }
    },
    {
        timestamps: true,
        collection: 'user_settings'
    }
);

/**
 * Indices for performance
 */
userSettingsSchema.index({ updatedAt: 1 });

export const UserSettings = mongoose.model<IUserSettings>(
    'UserSettings',
    userSettingsSchema
);

export default UserSettings;

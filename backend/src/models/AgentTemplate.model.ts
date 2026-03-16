import mongoose, { Document, Schema } from 'mongoose';
import { CANONICAL_ROBOT_IDS, CANONICAL_ROBOT_IDS_LABEL } from '../types/robotIds';

/**
 * Template d'agent - Réutilisable au niveau utilisateur
 * Stocke les configurations d'agents prédéfinies pour instantiation rapide
 * 
 * Différences avec AgentPrototype:
 * - AgentPrototype: Instance locale d'un workflow (scope: workflow)
 * - AgentTemplate: Configuration réutilisable globale (scope: utilisateur)
 */

export interface ITemplate {
  name: string;
  role: string;
  systemPrompt: string;
  llmProvider: string;
  llmModel: string;
  capabilities: string[];
  tools?: object[];
  outputConfig?: object;
  historyConfig?: object;
}

export interface IAgentTemplate extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  description: string;
  category: 'assistant' | 'specialist' | 'automation' | 'analysis';
  robotId: string;
  icon: string;
  template: ITemplate;
  sourcePrototypeId?: mongoose.Types.ObjectId;
  usageCount: number;
  isStarred: boolean;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

// Sub-schema pour la configuration de template
const TemplateSchema = new Schema<ITemplate>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100
    },
    role: {
      type: String,
      required: false,
      trim: true,
      maxlength: 200,
      default: ''
    },
    systemPrompt: {
      type: String,
      required: false,
      default: ''
    },
    llmProvider: {
      type: String,
      required: true,
      enum: ['Gemini', 'OpenAI', 'Mistral', 'Anthropic', 'Grok', 'Perplexity', 'Qwen', 'Kimi K2', 'DeepSeek', 'LLM local (on premise)', 'Arc-LLM', 'Mock']
    },
    llmModel: {
      type: String,
      required: true
    },
    capabilities: [
      {
        type: String
      }
    ],
    tools: [Schema.Types.Mixed],
    outputConfig: Schema.Types.Mixed,
    historyConfig: Schema.Types.Mixed
  },
  { _id: false }
);

const AgentTemplateSchema = new Schema<IAgentTemplate>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
      // Note: index userId is in composite indexes below
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 200
    },
    description: {
      type: String,
      required: false,
      default: '',
      maxlength: 500
    },
    category: {
      type: String,
      enum: {
        values: ['assistant', 'specialist', 'automation', 'analysis'],
        message: "Category must be one of: 'assistant', 'specialist', 'automation', 'analysis'"
      },
      default: 'assistant'
    },
    robotId: {
      type: String,
      required: true,
      enum: {
        values: [...CANONICAL_ROBOT_IDS],
        message: `RobotId must be one of: ${CANONICAL_ROBOT_IDS_LABEL}`
      }
    },
    icon: {
      type: String,
      required: false,
      default: '🤖',
      maxlength: 20
    },
    template: {
      type: TemplateSchema,
      required: true
    },
    sourcePrototypeId: {
      type: Schema.Types.ObjectId,
      ref: 'AgentPrototype',
      required: false
    },
    usageCount: {
      type: Number,
      default: 0,
      min: 0
    },
    isStarred: {
      type: Boolean,
      default: false
    },
    tags: [
      {
        type: String,
        trim: true,
        maxlength: 50
      }
    ]
  },
  {
    timestamps: true,
    collection: 'agent_templates'
  }
);

// ✅ Indexes pour optimisation des queries (redondants avec databaseInit.ts mais TypeScript-typés)
AgentTemplateSchema.index({ userId: 1, createdAt: -1 });
AgentTemplateSchema.index({ userId: 1, category: 1 });
AgentTemplateSchema.index({ userId: 1, isStarred: 1 });

export const AgentTemplate = mongoose.model<IAgentTemplate>(
  'AgentTemplate',
  AgentTemplateSchema
);

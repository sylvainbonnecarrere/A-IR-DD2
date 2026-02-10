/**
 * @fileoverview Index des modèles Mongoose - Export centralisé
 * 
 * Ce fichier exporte tous les modèles pour simplifier les imports.
 * 
 * Convention de nommage:
 * - Modèles V1 (legacy): AgentInstance, WorkflowNode
 * - Modèles V2 (nouvelle architecture): AgentInstanceV2, WorkflowNodeV2
 * 
 * @example
 * import { AgentInstanceV2, AgentJournal, WorkflowNodeV2 } from '../models';
 */

// ============================================
// MODÈLES UTILISATEUR & AUTH
// ============================================

export { User, IUser } from './User.model';
export { UserSettings, IUserSettings } from './UserSettings.model';

// ============================================
// MODÈLES WORKFLOW
// ============================================

export { Workflow, IWorkflow, ICanvasState } from './Workflow.model';
export { WorkflowEdge, IWorkflowEdge } from './WorkflowEdge.model';

// Legacy (V1)
export { WorkflowNode, IWorkflowNode } from './WorkflowNode.model';

// Nouvelle architecture (V2)
export { 
    WorkflowNodeV2, 
    IWorkflowNodeV2, 
    IWorkflowNodeUIConfig,
    WorkflowNodeType 
} from './WorkflowNodeV2.model';

// ============================================
// MODÈLES AGENT
// ============================================

// Legacy (V1) - Conservé pour rétrocompatibilité
export { 
    AgentInstance, 
    IAgentInstance,
    IAgentInstanceChatContent,
    IAgentInstanceImageContent,
    IAgentInstanceVideoContent,
    IAgentInstanceErrorContent,
    IAgentInstanceContent,
    IAgentInstanceMetrics
} from './AgentInstance.model';

// ✅ ÉTAPE 1: AgentInstanceV2 commenté - à supprimer en ÉTAPE 4
// Nouvelle architecture (V2)
/*
export { 
    AgentInstanceV2, 
    AgentInstanceLean,
    IAgentInstanceV2 
} from './AgentInstanceV2.model';
*/

export { AgentJournal, IAgentJournal } from './AgentJournal.model';

// ============================================
// MODÈLES PROTOTYPES
// ============================================

export { AgentPrototype, IAgentPrototype } from './AgentPrototype.model';

// ============================================
// MODÈLES CONFIGURATION LLM
// ============================================

export { LLMConfig, ILLMConfig } from './LLMConfig.model';

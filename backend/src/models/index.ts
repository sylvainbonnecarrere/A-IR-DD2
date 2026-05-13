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

export { User } from './User.model';
export type { IUser } from './User.model';
export { UserSettings } from './UserSettings.model';
export type { IUserSettings } from './UserSettings.model';

// ============================================
// MODÈLES WORKFLOW
// ============================================

export { Workflow } from './Workflow.model';
export type { IWorkflow, ICanvasState } from './Workflow.model';
export { WorkflowEdge } from './WorkflowEdge.model';
export type { IWorkflowEdge } from './WorkflowEdge.model';

// Legacy (V1)
export { WorkflowNode } from './WorkflowNode.model';
export type { IWorkflowNode } from './WorkflowNode.model';

// Nouvelle architecture (V2)
export { WorkflowNodeV2 } from './WorkflowNodeV2.model';
export type { 
    IWorkflowNodeV2, 
    IWorkflowNodeUIConfig,
    WorkflowNodeType 
} from './WorkflowNodeV2.model';

// ============================================
// MODÈLES AGENT
// ============================================

// Legacy (V1) - Conservé pour rétrocompatibilité
export { AgentInstance } from './AgentInstance.model';
export type { 
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

export { AgentJournal } from './AgentJournal.model';
export type { IAgentJournal } from './AgentJournal.model';

// ============================================
// MODÈLES PROTOTYPES
// ============================================

export { AgentPrototype } from './AgentPrototype.model';
export type { IAgentPrototype } from './AgentPrototype.model';
export { AgentTemplate } from './AgentTemplate.model';
export type { IAgentTemplate, ITemplate } from './AgentTemplate.model';

// ============================================
// MODÈLES TOOLS V2
// ============================================

export { Workspace } from './Workspace.model';
export type {
    IWorkspace,
    IWorkspaceRuntimeRoots,
    IWorkspaceManifests,
    IWorkspaceQuotas,
    WorkspaceScopeType,
    WorkspaceStatus,
    WorkspaceHealthStatus
} from './Workspace.model';
export { UserTool } from './UserTool.model';
export type {
    IUserTool,
    IUserToolVersion,
    IUserToolDependencies,
    IUserToolPolicy,
    UserToolScopeType,
    UserToolRuntime,
    UserToolStatus,
    UserToolTrustLevel,
    UserToolSourceMode,
    UserToolBuildStatus,
    UserToolValidationStatus,
    UserToolNetworkMode
} from './UserTool.model';
export { UserToolRun } from './UserToolRun.model';
export type {
    IUserToolRun,
    IUserToolRunArtifact,
    IUserToolRunOutputs,
    IUserToolRunPolicySnapshot,
    IUserToolRunTiming,
    IUserToolRunResourceUsage,
    IUserToolRunError,
    UserToolRunLaunchContext,
    UserToolRunStatus,
    UserToolRunRuntime,
    UserToolRunRunner,
    UserToolRunNetworkMode,
    UserToolRunArtifactKind
} from './UserToolRun.model';
export { SecretMetadata } from './SecretMetadata.model';
export type {
    ISecretMetadata,
    SecretMetadataScopeType,
    SecretMetadataStatus
} from './SecretMetadata.model';

// ============================================
// MODÈLES CONFIGURATION LLM
// ============================================

export { LLMConfig } from './LLMConfig.model';
export type { ILLMConfig } from './LLMConfig.model';

// ============================================
// MODÈLES MEDIA STORAGE
// ============================================

export { MediaReference } from './MediaReference.model';
export type { IMediaReference, IMediaReferenceCreate } from './MediaReference.model';

/**
 * Schemas Index - ÉTAPE 1.6 Persistence Contract
 * 
 * Point d'entrée unique pour tous les schémas Zod.
 * Import: import { AgentCreateSchema, validateAgentInstanceContent } from './schemas';
 */

// ============================================
// AGENT SCHEMAS
// ============================================
export {
    // Schemas
    AgentPositionSchema,
    AgentToolSchema,
    AgentHistoryConfigSchema,
    AgentOutputConfigSchema,
    RobotCreatorEnum,
    AgentCreateSchema,
    AgentUpdateSchema,
    AgentFullSchema,
    // Types
    type IAgentCreate,
    type IAgentUpdate,
    type IAgentFull,
    type IAgentPosition,
    type IAgentTool,
    type IRobotCreator,
    // Validators
    validateAgentCreate,
    validateAgentUpdate,
    validateAgentFull,
    safeValidateAgentCreate,
    safeValidateAgentUpdate
} from './agent.schema';

// ============================================
// AGENT INSTANCE SCHEMAS
// ============================================
export {
    // Content Schemas
    AgentInstanceChatContentSchema,
    AgentInstanceImageContentSchema,
    AgentInstanceVideoContentSchema,
    AgentInstanceErrorContentSchema,
    AgentInstanceContentSchema,
    // Enums
    ErrorSubTypeEnum,
    ErrorSourceEnum,
    ExecutionStatusEnum,
    // Main Schemas
    AgentInstanceMetricsSchema,
    AgentInstanceCreateSchema,
    AgentInstanceUpdateSchema,
    AgentInstanceAddContentSchema,
    AgentInstanceFullSchema,
    // Types
    type IAgentInstanceChatContent,
    type IAgentInstanceImageContent,
    type IAgentInstanceVideoContent,
    type IAgentInstanceErrorContent,
    type IAgentInstanceContent,
    type IAgentInstanceCreate,
    type IAgentInstanceUpdate,
    type IAgentInstanceFull,
    type IAgentInstanceMetrics,
    type IExecutionStatus,
    type IErrorSubType,
    type IErrorSource,
    // Validators
    validateAgentInstanceCreate,
    validateAgentInstanceUpdate,
    validateAgentInstanceContent,
    safeValidateAgentInstanceCreate,
    safeValidateAgentInstanceUpdate,
    safeValidateAgentInstanceContent,
    // Helpers
    createChatContent,
    createErrorContent
} from './agent-instance.schema';

// ============================================
// WEB SEARCH PARAMS SCHEMA
// ============================================
export {
    WebSearchParamsSchema,
    WEB_SEARCH_ENGINE_VALUES,
    WEB_SEARCH_RERANK_STRATEGY_VALUES,
    DEFAULT_WEB_SEARCH_MAX_CONTEXT_TOKENS,
    defaultWebSearchQueryTransformationPrompt,
    defaultWebSearchRerankingPrompt,
    parseWebSearchParams,
    type WebSearchParams,
} from './web-search-params.schema';

// ============================================
// WORKFLOW SCHEMAS
// ============================================
export {
    // Schemas
    CanvasStateSchema,
    WorkflowNodeSchema,
    WorkflowEdgeSchema,
    WorkflowCreateSchema,
    WorkflowUpdateSchema,
    WorkflowSaveSchema,
    WorkflowFullSchema,
    // Types
    type ICanvasState,
    type IWorkflowNode,
    type IWorkflowEdge,
    type IWorkflowCreate,
    type IWorkflowUpdate,
    type IWorkflowSave,
    type IWorkflowFull,
    // Validators
    validateWorkflowCreate,
    validateWorkflowUpdate,
    validateWorkflowSave,
    safeValidateWorkflowCreate,
    safeValidateWorkflowUpdate,
    safeValidateWorkflowSave
} from './workflow.schema';

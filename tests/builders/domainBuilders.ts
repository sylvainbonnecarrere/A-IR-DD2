import type { LLMResponse } from '../../services/adapters/ILLMAdapter';
import type { ParsedToolCall } from '../../services/llm/ToolCallParser';
import { LLMProvider, RobotId, type Agent, type AgentDraft, type AgentInstance, type ChatMessage, type ToolSelection, type V2WorkflowNode } from '../../types';
import type { ToolRegistryReadModel, UserFunction } from '../../types/function.types';

const DEFAULT_TIMESTAMP = '2026-01-01T00:00:00.000Z';

export function createToolSelection(overrides: Partial<ToolSelection> = {}): ToolSelection {
  return {
    toolId: 'tool.default',
    ...overrides,
  };
}

export function createTestAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-1',
    name: 'Test Agent',
    role: 'Archi',
    systemPrompt: 'Prompt',
    llmProvider: LLMProvider.OpenAI,
    model: 'gpt-4o-mini',
    capabilities: [],
    toolSelections: [createToolSelection({ toolId: 'tool.default' })],
    creator_id: RobotId.Archi,
    created_at: DEFAULT_TIMESTAMP,
    updated_at: DEFAULT_TIMESTAMP,
    ...overrides,
  };
}

export function createTestAgentDraft(overrides: Partial<AgentDraft> = {}): AgentDraft {
  return {
    name: 'Test Agent',
    role: 'Archi',
    systemPrompt: 'Prompt',
    llmProvider: LLMProvider.OpenAI,
    model: 'gpt-4o-mini',
    capabilities: [],
    tools: [],
    toolSelections: [createToolSelection({ toolId: 'tool.default' })],
    ...overrides,
  };
}

export function createTestAgentInstance(
  overrides: Partial<AgentInstance> & { configuration_json?: AgentInstance['configuration_json'] } = {},
): AgentInstance {
  const defaultConfiguration: NonNullable<AgentInstance['configuration_json']> = {
    role: 'Archi',
    model: 'gpt-4o-mini',
    llmProvider: LLMProvider.OpenAI,
    systemPrompt: 'Prompt',
    tools: [],
    toolSelections: [createToolSelection({ toolId: 'tool.default' })],
    position: { x: 0, y: 0 },
  };

  const configuration_json = overrides.configuration_json === null
    ? null
    : {
        ...defaultConfiguration,
        ...(overrides.configuration_json ?? {}),
      };

  return {
    id: 'instance-1',
    prototypeId: 'agent-1',
    workflowId: 'wf-1',
    name: 'Test Instance',
    position: { x: 0, y: 0 },
    isMinimized: false,
    isMaximized: false,
    persistenceConfig: undefined,
    configuration_json,
    ...overrides,
  };
}

export function createTestCanvasNode(
  overrides: Partial<V2WorkflowNode> & { data?: Partial<V2WorkflowNode['data']> } = {},
): V2WorkflowNode {
  const defaultAgent = createTestAgent();
  const defaultAgentInstance = createTestAgentInstance();

  return {
    id: 'node-1',
    type: 'agent',
    position: { x: 20, y: 20 },
    data: {
      robotId: RobotId.Archi,
      label: 'Test Node',
      agent: defaultAgent,
      agentInstance: defaultAgentInstance,
      workflowId: 'wf-1',
      ...overrides.data,
    },
    ...overrides,
  };
}

export function createTestChatMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    sender: 'user',
    text: 'Hello',
    timestamp: new Date(DEFAULT_TIMESTAMP),
    ...overrides,
  };
}

export function createTestParsedToolCall(overrides: Partial<ParsedToolCall> = {}): ParsedToolCall {
  return {
    name: 'tool_default',
    arguments: {},
    raw: '<tool_call />',
    confidence: 1,
    ...overrides,
  };
}

export function createTestLLMResponse(overrides: Partial<LLMResponse> = {}): LLMResponse {
  return {
    content: 'Done',
    finishReason: 'stop',
    ...overrides,
  };
}

export function createTestToolRegistryReadModel(overrides: Partial<ToolRegistryReadModel> = {}): ToolRegistryReadModel {
  return {
    id: 'tool.default',
    legacyFunctionId: 'fn-default',
    name: 'tool_default',
    description: 'Test tool',
    inputSchema: { type: 'object' },
    isEnabled: true,
    versionTag: 'v1',
    versionNumber: 1,
    workspaceId: 'ws-1',
    ...overrides,
  };
}

export function createTestUserFunction(overrides: Partial<UserFunction> = {}): UserFunction {
  return {
    _id: '507f1f77bcf86cd799439011',
    toolId: 'tool.default',
    name: 'tool_default',
    description: 'Test tool',
    language: 'python',
    origin: 'native',
    userId: null,
    workflowId: 'wf-1',
    inputSchema: {},
    outputSchema: {},
    codePath: null,
    codeInline: null,
    dependencies: [],
    isEnabled: true,
    isReadonly: false,
    version: 1,
    versionTag: '1.0.0',
    tags: [],
    createdAt: DEFAULT_TIMESTAMP,
    updatedAt: DEFAULT_TIMESTAMP,
    ...overrides,
  };
}
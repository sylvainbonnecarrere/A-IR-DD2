import {
  Agent,
  AgentInstance,
  LLMCapability,
  LLMProvider,
  PersistenceConfig,
  RobotId,
  Tool,
  ToolSelection,
  ToolVersionRef,
  V2WorkflowNode,
  WorkflowNode,
  normalizePersistenceConfig,
  sanitizePersistenceConfigForApi,
} from '../types';
import { normalizeAgentToolReferences } from './toolSelectionResolver';

type LegacyRecord = Record<string, unknown>;

export type CanonicalAgentInstanceConfiguration = NonNullable<AgentInstance['configuration_json']>;

function isRecord(value: unknown): value is LegacyRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown): LegacyRecord {
  return isRecord(value) ? value : {};
}

function readString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }

  return undefined;
}

function readBoolean(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === 'boolean') {
      return value;
    }
  }

  return undefined;
}

function readObject<T>(...values: unknown[]): T | undefined {
  for (const value of values) {
    if (isRecord(value)) {
      return value as T;
    }
  }

  return undefined;
}

function readList(...values: unknown[]): any[] {
  for (const value of values) {
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function readPosition(...values: unknown[]): { x: number; y: number } {
  for (const value of values) {
    if (isRecord(value) && typeof value.x === 'number' && typeof value.y === 'number') {
      return { x: value.x, y: value.y };
    }
  }

  return { x: 0, y: 0 };
}

function isLLMProvider(value: unknown): value is LLMProvider {
  return typeof value === 'string' && (Object.values(LLMProvider) as string[]).includes(value);
}

function resolveLLMProvider(...values: unknown[]): LLMProvider {
  for (const value of values) {
    if (isLLMProvider(value)) {
      return value;
    }
  }

  return LLMProvider.Gemini;
}

function isRobotId(value: unknown): value is RobotId {
  return typeof value === 'string' && (Object.values(RobotId) as string[]).includes(value);
}

function resolveRobotId(...values: unknown[]): RobotId {
  for (const value of values) {
    if (isRobotId(value)) {
      return value;
    }
  }

  return RobotId.Archi;
}

function isLLMCapability(value: unknown): value is LLMCapability {
  return typeof value === 'string' && (Object.values(LLMCapability) as string[]).includes(value);
}

function readCapabilities(...values: unknown[]): LLMCapability[] {
  for (const value of values) {
    if (Array.isArray(value)) {
      return value.filter(isLLMCapability);
    }
  }

  return [];
}

function normalizeLegacyIdList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (entry && typeof entry === 'object' && 'toString' in entry)
      ? (entry as { toString: () => string }).toString()
      : String(entry))
    .filter((entry) => entry.length > 0);
}

function readToolSelections(...values: unknown[]): ToolSelection[] | undefined {
  for (const value of values) {
    if (!Array.isArray(value)) {
      continue;
    }

    return value.flatMap((candidate) => {
      if (!isRecord(candidate) || typeof candidate.toolId !== 'string' || candidate.toolId.trim().length === 0) {
        return [];
      }

      const versionRef: ToolVersionRef | undefined = isRecord(candidate.versionRef)
        ? {
            versionTag: typeof candidate.versionRef.versionTag === 'string' ? candidate.versionRef.versionTag : undefined,
            versionNumber: typeof candidate.versionRef.versionNumber === 'number' ? candidate.versionRef.versionNumber : undefined,
            workspaceId: typeof candidate.versionRef.workspaceId === 'string'
              ? candidate.versionRef.workspaceId
              : (candidate.versionRef.workspaceId === null ? null : undefined),
          }
        : undefined;

      const selection: ToolSelection = versionRef
        ? { toolId: candidate.toolId, versionRef }
        : { toolId: candidate.toolId };

      return [selection];
    });
  }

  return undefined;
}

function sanitizeProviderTools(rawTools: unknown): Tool[] {
  if (!Array.isArray(rawTools)) {
    return [];
  }

  return rawTools.flatMap((candidate) => {
    if (!isRecord(candidate)) {
      return [];
    }

    const rawName = candidate.name;
    const name = typeof rawName === 'string' ? rawName.trim() : '';

    if (name.length === 0) {
      return [];
    }

    const description = typeof candidate.description === 'string' ? candidate.description : '';
    const parameters = candidate.parameters;
    const outputSchema = candidate.outputSchema;

    const tool: Tool = {
      name,
      description,
      parameters: parameters && typeof parameters === 'object' && !Array.isArray(parameters)
        ? parameters
        : { type: 'object' },
      ...(outputSchema !== undefined ? { outputSchema } : {}),
    };

    return [tool];
  });
}

export function createDefaultAgentInstanceConfiguration(): CanonicalAgentInstanceConfiguration {
  return {
    role: '',
    model: '',
    llmProvider: LLMProvider.OpenAI,
    systemPrompt: '',
    tools: [],
    outputConfig: undefined,
    webSearchParams: undefined,
    capabilities: [],
    historyConfig: undefined,
    localLLMProfileId: undefined,
    functionInheritance: undefined,
    toolSelections: [],
    position: { x: 0, y: 0 },
    links: [],
    tasks: [],
    logs: [],
    errors: [],
  };
}

export function mapPersistedPrototypeToAgent(prototype: unknown, fallbackTimestamp: string): Agent {
  const record = readRecord(prototype);
  const normalizedToolReferences = normalizeAgentToolReferences(
    readToolSelections(record.toolSelections),
    Array.isArray(record.functionIds)
      ? normalizeLegacyIdList(record.functionIds)
      : normalizeLegacyIdList(record.tools),
  );

  return {
    id: readString(record.id, record._id) ?? '',
    name: readString(record.name) ?? '',
    role: readString(record.role, record.description) ?? 'assistant',
    systemPrompt: readString(record.systemPrompt, record.description) ?? '',
    llmProvider: resolveLLMProvider(record.llmProvider, record.provider),
    model: readString(record.model, record.llmModel) ?? 'gemini-2.0-flash',
    capabilities: readCapabilities(record.capabilities),
    historyConfig: readObject(record.historyConfig),
    tools: sanitizeProviderTools(record.tools),
    functionIds: normalizedToolReferences.functionIds,
    toolSelections: normalizedToolReferences.toolSelections,
    outputConfig: readObject(record.outputConfig),
    webSearchParams: readObject(record.webSearchParams),
    persistenceConfig: isRecord(record.persistenceConfig)
      ? normalizePersistenceConfig(record.persistenceConfig as Partial<PersistenceConfig>)
      : undefined,
    creator_id: resolveRobotId(record.creator_id, record.robotId),
    created_at: readString(record.created_at, record.createdAt) ?? fallbackTimestamp,
    updated_at: readString(record.updated_at, record.updatedAt) ?? fallbackTimestamp,
    localLLMProfileId: readString(record.localLLMProfileId),
    instanceName: readString(record.instanceName),
  };
}

export function buildCanonicalAgentInstanceConfiguration(
  instance: unknown,
  prototype?: Agent,
): CanonicalAgentInstanceConfiguration {
  const defaults = createDefaultAgentInstanceConfiguration();
  const instanceRecord = readRecord(instance);
  const configuration = readRecord(instanceRecord.configuration_json);
  const normalizedToolReferences = normalizeAgentToolReferences(
    readToolSelections(configuration.toolSelections, instanceRecord.toolSelections, prototype?.toolSelections),
    Array.isArray(configuration.functionIds)
      ? normalizeLegacyIdList(configuration.functionIds)
      : Array.isArray(instanceRecord.functionIds)
        ? normalizeLegacyIdList(instanceRecord.functionIds)
        : normalizeLegacyIdList(prototype?.functionIds),
  );
  const resolvedProviderTools = configuration.tools !== undefined
    ? configuration.tools
    : (instanceRecord.tools !== undefined ? instanceRecord.tools : prototype?.tools);

  return {
    ...defaults,
    role: readString(configuration.role, instanceRecord.role, prototype?.role) ?? defaults.role,
    model: readString(configuration.model, instanceRecord.llmModel, instanceRecord.model, prototype?.model) ?? 'gemini-2.0-flash',
    llmProvider: resolveLLMProvider(configuration.llmProvider, instanceRecord.llmProvider, instanceRecord.provider, prototype?.llmProvider, defaults.llmProvider),
    systemPrompt: readString(configuration.systemPrompt, instanceRecord.systemPrompt, instanceRecord.systemInstruction, prototype?.systemPrompt) ?? defaults.systemPrompt,
    tools: sanitizeProviderTools(resolvedProviderTools),
    outputConfig: readObject(configuration.outputConfig, instanceRecord.outputConfig, prototype?.outputConfig),
    webSearchParams: readObject(configuration.webSearchParams, instanceRecord.webSearchParams, prototype?.webSearchParams),
    capabilities: readCapabilities(configuration.capabilities, instanceRecord.capabilities, prototype?.capabilities),
    historyConfig: readObject(configuration.historyConfig, instanceRecord.historyConfig, prototype?.historyConfig),
    localLLMProfileId: readString(configuration.localLLMProfileId, instanceRecord.localLLMProfileId, prototype?.localLLMProfileId),
    functionInheritance: readObject(configuration.functionInheritance, instanceRecord.functionInheritance),
    toolSelections: normalizedToolReferences.toolSelections.length > 0
      ? normalizedToolReferences.toolSelections
      : (prototype?.toolSelections ?? defaults.toolSelections),
    position: readPosition(configuration.position, instanceRecord.position),
    links: readList(configuration.links, instanceRecord.links),
    tasks: readList(configuration.tasks, instanceRecord.tasks),
    logs: readList(configuration.logs, instanceRecord.logs),
    errors: readList(configuration.errors, instanceRecord.errors),
  };
}

export function mapPersistedInstanceToAgentInstance(
  instance: unknown,
  workflowId?: string,
  prototype?: Agent,
): AgentInstance {
  const record = readRecord(instance);
  const configuration = buildCanonicalAgentInstanceConfiguration(record, prototype);
  const id = readString(record.id, record._id) ?? '';
  const rawPersistenceConfig = isRecord(record.persistenceConfig)
    ? (sanitizePersistenceConfigForApi(record.persistenceConfig as Partial<PersistenceConfig>) ?? record.persistenceConfig as Partial<PersistenceConfig>)
    : undefined;

  return {
    id,
    prototypeId: readString(record.prototypeId) ?? prototype?.id ?? id,
    name: readString(record.name) ?? prototype?.name ?? '',
    position: readPosition(record.position, configuration.position),
    isMinimized: readBoolean(record.isMinimized) ?? false,
    isMaximized: readBoolean(record.isMaximized) ?? false,
    workflowId: readString(record.workflowId, workflowId),
    persistenceConfig: rawPersistenceConfig ? normalizePersistenceConfig(rawPersistenceConfig) : undefined,
    configuration_json: configuration,
  };
}

export function mapPersistedInstanceToLegacyWorkflowNode(
  instance: unknown,
  workflowId: string | undefined,
  prototype?: Agent,
  fallbackTimestamp?: string,
): WorkflowNode {
  const record = readRecord(instance);
  const timestamp = fallbackTimestamp ?? new Date().toISOString();
  const hydratedInstance = mapPersistedInstanceToAgentInstance(record, workflowId, prototype);
  const hydratedAgent: Agent = prototype ?? {
    id: hydratedInstance.prototypeId,
    name: readString(record.name) ?? hydratedInstance.name,
    role: hydratedInstance.configuration_json.role,
    systemPrompt: hydratedInstance.configuration_json.systemPrompt,
    llmProvider: hydratedInstance.configuration_json.llmProvider,
    model: hydratedInstance.configuration_json.model,
    capabilities: hydratedInstance.configuration_json.capabilities ?? [],
    tools: hydratedInstance.configuration_json.tools ?? [],
    historyConfig: hydratedInstance.configuration_json.historyConfig,
    outputConfig: hydratedInstance.configuration_json.outputConfig,
    webSearchParams: hydratedInstance.configuration_json.webSearchParams,
    localLLMProfileId: hydratedInstance.configuration_json.localLLMProfileId,
    creator_id: resolveRobotId(record.creator_id, record.robotId),
    created_at: readString(record.created_at, record.createdAt) ?? timestamp,
    updated_at: readString(record.updated_at, record.updatedAt) ?? timestamp,
  };

  return {
    id: hydratedInstance.id,
    agent: hydratedAgent,
    position: hydratedInstance.position,
    messages: [],
    isMinimized: hydratedInstance.isMinimized,
    isMaximized: hydratedInstance.isMaximized,
    instanceId: hydratedInstance.id,
  };
}

export function mapPersistedInstanceToV2Node(
  instance: unknown,
  workflowId: string | undefined,
  prototype?: Agent,
  fallbackTimestamp?: string,
): V2WorkflowNode {
  const legacyNode = mapPersistedInstanceToLegacyWorkflowNode(instance, workflowId, prototype, fallbackTimestamp);
  const hydratedInstance = mapPersistedInstanceToAgentInstance(instance, workflowId, prototype);

  return {
    id: `node-${hydratedInstance.id}`,
    type: 'agent',
    position: hydratedInstance.position,
    data: {
      robotId: legacyNode.agent.creator_id,
      label: hydratedInstance.name,
      agent: legacyNode.agent,
      agentInstance: hydratedInstance,
      workflowId,
      isMinimized: hydratedInstance.isMinimized,
      isMaximized: hydratedInstance.isMaximized,
    },
  };
}
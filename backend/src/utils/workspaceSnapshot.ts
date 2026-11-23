import { AgentInstance } from '../models/AgentInstance.model';
import { AgentJournal } from '../models/AgentJournal.model';
import { AgentPrototype } from '../models/AgentPrototype.model';
import { LLMConfig } from '../models/LLMConfig.model';
import { UserToolRun } from '../models/UserToolRun.model';
import UserSettings from '../models/UserSettings.model';
import { WorkflowEdge } from '../models/WorkflowEdge.model';
import type { RuntimeCompatibilityContext } from '../services/runtimeCompatibility.service';
import { buildChatMessagesByInstance } from './chatMessageProjection';
import { transformAgentInstanceForFrontend } from './transforms';

import type {
  ProjectedChatMessage,
  SnapshotAgentInstanceDoc,
  SnapshotAgentInstanceNode,
  SnapshotAgentPrototypeDoc,
  SnapshotEdgeDoc,
  SnapshotJournalEntryDoc,
  SnapshotLLMConfigDoc,
  SnapshotUserToolRunDoc,
  SnapshotWorkflowDoc,
} from '../domain/workflow/workspaceSnapshot.contract';
import { snapshotIdToString } from '../domain/workflow/workspaceSnapshot.contract';

// ⭐ le champ canvasState reste hors du contrat domaine (l'audit strict classe
// backend/src/domain/ comme UNKNOWN sur ce token) : il est déclaré ici, surface COMPATIBILITY.
type SnapshotWorkflowLike = SnapshotWorkflowDoc & {
  canvasState?: {
    zoom: number;
    panX: number;
    panY: number;
  };
};

interface SnapshotWorkspaceLike {
  _id?: { toString(): string };
  id?: string;
  scopeType: 'project' | 'workflow';
  scopeId: { toString(): string } | string;
  status: 'active' | 'missing' | 'corrupted' | 'archived';
  manifests?: {
    packageJson?: boolean;
    packageLockJson?: boolean;
    requirementsTxt?: boolean;
    pyprojectToml?: boolean;
  };
  lastScanAt?: Date | null;
}

export interface WorkspaceSnapshot {
  runtimeCompatibility?: RuntimeCompatibilityContext;
  workspaceContext?: {
    id: string;
    scopeType: 'project' | 'workflow';
    scopeId: string;
    status: 'active' | 'missing' | 'corrupted' | 'archived';
    manifests: {
      packageJson: boolean;
      packageLockJson: boolean;
      requirementsTxt: boolean;
      pyprojectToml: boolean;
    };
    lastScanAt?: Date | null;
  };
  workflow: {
    id: string;
    name: string;
    description?: string;
    isActive: boolean;
    isDefault: boolean;
    isDirty: boolean;
    canvasState: {
      zoom: number;
      panX: number;
      panY: number;
    };
    createdAt: Date;
    updatedAt: Date;
    lastSavedAt?: Date;
  } | null;
  nodes: Array<{
    id: string;
    agentId: string;
    agentName: string;
    position: { x: number; y: number };
    provider?: string;
    model?: string;
    createdAt?: Date;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    type: 'default' | 'step' | 'smoothstep' | 'straight';
    data?: {
      label?: string;
    };
  }>;
  agentInstances: SnapshotAgentInstanceNode[];
  agentPrototypes: Array<{
    id: string;
    name: string;
    provider: string;
    model: string;
    description?: string;
    role?: string;
    systemPrompt?: string;
    capabilities: string[];
    tools: string[];
    functionIds: string[];
    historyConfig?: object;
    outputConfig?: object;
    robotId?: string;
    created_at?: Date;
    updated_at?: Date;
  }>;
  llmConfigs: Array<{
    id: string;
    provider: string;
    enabled: boolean;
    hasApiKey: boolean;
    capabilities: Record<string, boolean>;
    updatedAt: Date;
  }>;
  toolRuns: Array<{
    id: string;
    executionId: string;
    toolId: string;
    toolVersionTag: string;
    toolContentHash: string;
    workflowId?: string;
    agentPrototypeId?: string;
    agentInstanceId?: string;
    launchContext: 'editor_test' | 'workflow_run' | 'system_validation';
    status: 'queued' | 'running' | 'completed' | 'failed' | 'stopped' | 'timed_out' | 'worker_lost' | 'quarantined';
    runtime: 'typescript' | 'python';
    runner: 'docker_sandbox' | 'docker_rootless' | 'firecracker';
    inputs: Record<string, unknown>;
    outputs?: {
      result?: unknown;
      stdout?: string;
      stderr?: string;
      artifacts?: Array<{
        path: string;
        kind: 'file' | 'json' | 'log';
      }>;
    };
    error?: {
      code?: string;
      message: string;
      retryable?: boolean;
    };
    timing: {
      queuedAt?: Date | null;
      startedAt?: Date | null;
      finishedAt?: Date | null;
      durationMs?: number | null;
    };
    createdAt: Date;
    updatedAt: Date;
  }>;
  userSettings: {
    language: string;
    theme: string;
  };
  metadata: {
    loadedAt: Date;
    userId: string;
    hasWorkflow: boolean;
    workflowWasCreated?: boolean;
    healingActions?: string[];
  };
}

interface BuildWorkspaceSnapshotOptions {
  userId: string;
  workflow: SnapshotWorkflowLike | null;
  workspace?: SnapshotWorkspaceLike | null;
  runtimeCompatibility?: RuntimeCompatibilityContext;
  wasCreated?: boolean;
  healingActions?: string[];
  includeLegacyPrototypes?: boolean;
}

export function sanitizeLegacyWorkflowGraphFields(workflow: SnapshotWorkflowLike | null): SnapshotWorkflowLike | null {
  if (!workflow || typeof workflow !== 'object') {
    return workflow;
  }

  const source: Record<string, unknown> =
    typeof workflow.toObject === 'function' ? (workflow.toObject() as Record<string, unknown>) : { ...workflow };

  const sanitized: Record<string, unknown> = { ...source };
  sanitized.id = workflow.id ?? sanitized.id ?? (workflow._id !== undefined ? snapshotIdToString(workflow._id) : undefined);
  sanitized._id = workflow._id ?? sanitized._id;
  delete sanitized.nodes;
  delete sanitized.edges;
  return sanitized as unknown as SnapshotWorkflowLike;
}

function transformWorkflowEdgeForFrontend(edge: SnapshotEdgeDoc) {
  const sourceInstanceId = edge.sourceInstanceId?.toString() || edge.sourceId || edge.sourceNodeId || '';
  const targetInstanceId = edge.targetInstanceId?.toString() || edge.targetId || edge.targetNodeId || '';

  return {
    id: (edge._id?.toString() || edge.id) as string,
    source: sourceInstanceId.startsWith('node-') ? sourceInstanceId : `node-${sourceInstanceId}`,
    target: targetInstanceId.startsWith('node-') ? targetInstanceId : `node-${targetInstanceId}`,
    type: (edge.edgeType || edge.type || 'default') as 'default' | 'step' | 'smoothstep' | 'straight',
    data: edge.label ? { label: edge.label } : undefined,
  };
}

function transformAgentPrototypeForFrontend(proto: SnapshotAgentPrototypeDoc) {
  const legacyToolIds = Array.isArray(proto.tools) ? (proto.tools as unknown[]).map((toolId: unknown) => String(toolId)) : [];
  const selectedToolIds = Array.isArray(proto.toolSelections)
    ? (proto.toolSelections as unknown[])
        .map((selection: unknown) => (selection as { toolId?: unknown } | null)?.toolId)
        .filter((toolId: unknown): toolId is string => typeof toolId === 'string' && toolId.trim().length > 0)
    : [];
  const functionIds = selectedToolIds.length > 0 ? selectedToolIds : legacyToolIds;

  return {
    id: (proto._id?.toString() || proto.id) as string,
    name: proto.name,
    provider: proto.llmProvider,
    model: proto.llmModel,
    description: proto.role,
    role: proto.role,
    systemPrompt: proto.systemPrompt,
    capabilities: (Array.isArray(proto.capabilities) ? proto.capabilities : []) as string[],
    tools: [],
    functionIds,
    toolSelections: (Array.isArray(proto.toolSelections)
      ? proto.toolSelections
      : functionIds.map((toolId: string) => ({ toolId }))) as Array<{ toolId: string }>,
    historyConfig: proto.historyConfig as object | undefined,
    outputConfig: proto.outputConfig as object | undefined,
    robotId: proto.robotId,
    created_at: proto.createdAt,
    updated_at: proto.updatedAt,
  };
}

function transformUserToolRunForFrontend(run: SnapshotUserToolRunDoc) {
  return {
    id: (run._id?.toString() || run.id) as string,
    executionId: run.executionId,
    toolId: run.toolId?.toString() || '',
    toolVersionTag: run.toolVersionTag,
    toolContentHash: run.toolContentHash,
    workflowId: run.workflowId?.toString(),
    agentPrototypeId: run.agentPrototypeId?.toString(),
    agentInstanceId: run.agentInstanceId?.toString(),
    launchContext: run.launchContext,
    status: run.status,
    runtime: run.runtime,
    runner: run.runner,
    inputs: run.inputs || {},
    outputs: run.outputs || undefined,
    error: run.error || undefined,
    timing: run.timing || {},
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

export async function buildWorkspaceSnapshot({
  userId,
  workflow,
  workspace = null,
  runtimeCompatibility,
  wasCreated = false,
  healingActions = [],
  includeLegacyPrototypes = true,
}: BuildWorkspaceSnapshotOptions): Promise<WorkspaceSnapshot> {
  const sanitizedWorkflow = sanitizeLegacyWorkflowGraphFields(workflow);
  const workflowId = sanitizedWorkflow?._id?.toString() || sanitizedWorkflow?.id || null;
  const prototypeWorkflowFilter = workflowId
    ? includeLegacyPrototypes
      ? {
          $or: [{ workflowId }, { workflowId: { $exists: false } }, { workflowId: null }],
        }
      : { workflowId }
    : { workflowId: { $exists: false } };

  const userToolRunFilter = workflowId ? { ownerUserId: userId, workflowId } : { ownerUserId: userId };

  const [agentInstances, edges, journalEntries, agentPrototypes, llmConfigs, userSettings, toolRuns] = await Promise.all([
    workflowId ? AgentInstance.find({ workflowId }) : Promise.resolve([]),
    workflowId ? WorkflowEdge.find({ workflowId }) : Promise.resolve([]),
    workflowId ? AgentJournal.find({ workflowId, type: { $in: ['chat', 'tool_invocation'] } }).sort({ timestamp: 1 }) : Promise.resolve([]),
    AgentPrototype.find({ userId, ...prototypeWorkflowFilter }).sort({ name: 1 }),
    LLMConfig.find({ userId }),
    UserSettings.findOne({ userId }),
    UserToolRun.find(userToolRunFilter).sort({ createdAt: -1 }).limit(200),
  ]);

  const toolRunsByExecutionId = new Map<string, SnapshotUserToolRunDoc>(toolRuns.map((run) => [run.executionId, run] as const));
  const chatMessagesByInstance: Record<string, ProjectedChatMessage[]> = buildChatMessagesByInstance(journalEntries, toolRunsByExecutionId);
  const transformedInstances: SnapshotAgentInstanceNode[] = agentInstances.map((instance) => {
    const transformed = transformAgentInstanceForFrontend(instance);
    const instanceId = transformed.id ?? '';

    return {
      ...transformed,
      provider: transformed.llmProvider,
      model: transformed.llmModel,
      systemInstruction: transformed.systemPrompt,
      position: transformed.position || transformed.configuration_json?.position || { x: 0, y: 0 },
      chatMessages: chatMessagesByInstance[instanceId] || [],
    };
  });

  return {
    runtimeCompatibility,
    workspaceContext: workspace
      ? {
          id: workspace._id?.toString() || workspace.id || '',
          scopeType: workspace.scopeType,
          scopeId: typeof workspace.scopeId === 'string' ? workspace.scopeId : workspace.scopeId.toString(),
          status: workspace.status,
          manifests: {
            packageJson: !!workspace.manifests?.packageJson,
            packageLockJson: !!workspace.manifests?.packageLockJson,
            requirementsTxt: !!workspace.manifests?.requirementsTxt,
            pyprojectToml: !!workspace.manifests?.pyprojectToml,
          },
          lastScanAt: workspace.lastScanAt ?? null,
        }
      : undefined,
    workflow:
      sanitizedWorkflow && workflowId
        ? {
            id: workflowId,
            name: sanitizedWorkflow.name,
            description: sanitizedWorkflow.description,
            isActive: sanitizedWorkflow.isActive,
            isDefault: sanitizedWorkflow.isDefault || false,
            isDirty: sanitizedWorkflow.isDirty || false,
            canvasState: sanitizedWorkflow.canvasState || {
              zoom: 1,
              panX: 0,
              panY: 0,
            },
            createdAt: sanitizedWorkflow.createdAt,
            updatedAt: sanitizedWorkflow.updatedAt,
            lastSavedAt: sanitizedWorkflow.lastSavedAt,
          }
        : null,
    nodes: transformedInstances.map((instance) => ({
      id: `node-${instance.id}`,
      agentId: instance.id as string,
      agentName: instance.name as string,
      position: instance.position || { x: 0, y: 0 },
      provider: instance.provider,
      model: instance.model,
      createdAt: instance.createdAt,
    })),
    edges: edges.map((edge) => transformWorkflowEdgeForFrontend(edge)),
    agentInstances: transformedInstances,
    agentPrototypes: agentPrototypes.map((proto) => transformAgentPrototypeForFrontend(proto)),
    llmConfigs: llmConfigs.map((config) => ({
      id: config.id,
      provider: config.provider,
      enabled: config.enabled,
      hasApiKey: !!config.apiKeyEncrypted,
      capabilities: config.capabilities || {},
      updatedAt: config.updatedAt,
    })),
    toolRuns: toolRuns.map((run) => transformUserToolRunForFrontend(run)),
    userSettings: {
      language: userSettings?.preferences?.language || 'fr',
      theme: userSettings?.preferences?.theme || 'dark',
    },
    metadata: {
      loadedAt: new Date(),
      userId,
      hasWorkflow: !!workflow,
      workflowWasCreated: wasCreated,
      healingActions: healingActions.length > 0 ? healingActions : undefined,
    },
  };
}

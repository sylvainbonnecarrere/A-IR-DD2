import { AgentInstance } from '../models/AgentInstance.model';
import { AgentJournal } from '../models/AgentJournal.model';
import { AgentPrototype } from '../models/AgentPrototype.model';
import { LLMConfig } from '../models/LLMConfig.model';
import { UserToolRun } from '../models/UserToolRun.model';
import UserSettings from '../models/UserSettings.model';
import { WorkflowEdge } from '../models/WorkflowEdge.model';
import type { RuntimeCompatibilityContext } from '../services/runtimeCompatibility.service';
import { transformAgentInstanceForFrontend } from './transforms';

interface SnapshotWorkflowLike {
    _id?: { toString(): string };
    id?: string;
    name: string;
    description?: string;
    isActive: boolean;
    isDefault?: boolean;
    isDirty?: boolean;
    canvasState?: {
        zoom: number;
        panX: number;
        panY: number;
    };
    createdAt: Date;
    updatedAt: Date;
    lastSavedAt?: Date;
}

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
    agentInstances: any[];
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
        status: 'queued' | 'running' | 'completed' | 'failed' | 'stopped' | 'timed_out';
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

function transformWorkflowEdgeForFrontend(edge: any) {
    const sourceInstanceId = edge.sourceInstanceId?.toString() || edge.sourceId || edge.sourceNodeId || '';
    const targetInstanceId = edge.targetInstanceId?.toString() || edge.targetId || edge.targetNodeId || '';

    return {
        id: edge._id?.toString() || edge.id,
        source: sourceInstanceId.startsWith('node-') ? sourceInstanceId : `node-${sourceInstanceId}`,
        target: targetInstanceId.startsWith('node-') ? targetInstanceId : `node-${targetInstanceId}`,
        type: edge.edgeType || edge.type || 'default',
        data: edge.label ? { label: edge.label } : undefined
    };
}

function transformAgentPrototypeForFrontend(proto: any) {
    const toolIds = Array.isArray(proto.tools)
        ? proto.tools.map((toolId: any) => toolId?.toString?.() || String(toolId))
        : [];

    return {
        id: proto._id?.toString() || proto.id,
        name: proto.name,
        provider: proto.llmProvider,
        model: proto.llmModel,
        description: proto.role,
        role: proto.role,
        systemPrompt: proto.systemPrompt,
        capabilities: Array.isArray(proto.capabilities) ? proto.capabilities : [],
        tools: toolIds,
        functionIds: toolIds,
        historyConfig: proto.historyConfig,
        outputConfig: proto.outputConfig,
        robotId: proto.robotId,
        created_at: proto.createdAt,
        updated_at: proto.updatedAt
    };
}

function transformUserToolRunForFrontend(run: any) {
    return {
        id: run._id?.toString() || run.id,
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
        updatedAt: run.updatedAt
    };
}

function buildChatMessagesByInstance(entries: any[]) {
    const journalByInstance: Record<string, any[]> = {};

    for (const entry of entries) {
        const instanceId = entry.agentInstanceId?.toString() || '';
        if (!journalByInstance[instanceId]) {
            journalByInstance[instanceId] = [];
        }
        journalByInstance[instanceId].push({
            sender: entry.payload?.role || 'agent',
            text: entry.payload?.content || '',
            timestamp: entry.timestamp,
            image: entry.payload?.imageBase64,
            mimeType: entry.payload?.mimeType,
            fileName: entry.payload?.fileName,
            llmProvider: entry.payload?.llmProvider,
            modelUsed: entry.payload?.modelUsed,
            tokensUsed: entry.payload?.tokensUsed,
            toolCalls: entry.payload?.toolCalls
        });
    }

    return journalByInstance;
}

export async function buildWorkspaceSnapshot({
    userId,
    workflow,
    workspace = null,
    runtimeCompatibility,
    wasCreated = false,
    healingActions = [],
    includeLegacyPrototypes = true
}: BuildWorkspaceSnapshotOptions): Promise<WorkspaceSnapshot> {
    const workflowId = workflow?._id?.toString() || workflow?.id || null;
    const prototypeWorkflowFilter = workflowId
        ? (includeLegacyPrototypes
            ? {
                $or: [
                    { workflowId },
                    { workflowId: { $exists: false } },
                    { workflowId: null }
                ]
            }
            : { workflowId })
        : { workflowId: { $exists: false } };

    const userToolRunFilter = workflowId
        ? { ownerUserId: userId, workflowId }
        : { ownerUserId: userId };

    const [agentInstances, edges, journalEntries, agentPrototypes, llmConfigs, userSettings, toolRuns] = await Promise.all([
        workflowId ? AgentInstance.find({ workflowId }) : Promise.resolve([]),
        workflowId ? WorkflowEdge.find({ workflowId }) : Promise.resolve([]),
        workflowId ? AgentJournal.find({ workflowId, type: 'chat' }).sort({ timestamp: 1 }) : Promise.resolve([]),
        AgentPrototype.find({ userId, ...prototypeWorkflowFilter }).sort({ name: 1 }),
        LLMConfig.find({ userId }),
        UserSettings.findOne({ userId }),
        UserToolRun.find(userToolRunFilter).sort({ createdAt: -1 }).limit(200)
    ]);

    const chatMessagesByInstance = buildChatMessagesByInstance(journalEntries);
    const transformedInstances = agentInstances.map((instance: any) => {
        const transformed = transformAgentInstanceForFrontend(instance);
        const instanceId = transformed.id;

        return {
            ...transformed,
            provider: transformed.llmProvider,
            model: transformed.llmModel,
            systemInstruction: transformed.systemPrompt,
            position: transformed.position || transformed.configuration_json?.position || { x: 0, y: 0 },
            chatMessages: chatMessagesByInstance[instanceId] || []
        };
    });

    return {
        runtimeCompatibility,
        workspaceContext: workspace ? {
            id: workspace._id?.toString() || workspace.id || '',
            scopeType: workspace.scopeType,
            scopeId: typeof workspace.scopeId === 'string' ? workspace.scopeId : workspace.scopeId.toString(),
            status: workspace.status,
            manifests: {
                packageJson: !!workspace.manifests?.packageJson,
                packageLockJson: !!workspace.manifests?.packageLockJson,
                requirementsTxt: !!workspace.manifests?.requirementsTxt,
                pyprojectToml: !!workspace.manifests?.pyprojectToml
            },
            lastScanAt: workspace.lastScanAt ?? null
        } : undefined,
        workflow: workflow && workflowId ? {
            id: workflowId,
            name: workflow.name,
            description: workflow.description,
            isActive: workflow.isActive,
            isDefault: workflow.isDefault || false,
            isDirty: workflow.isDirty || false,
            canvasState: workflow.canvasState || {
                zoom: 1,
                panX: 0,
                panY: 0
            },
            createdAt: workflow.createdAt,
            updatedAt: workflow.updatedAt,
            lastSavedAt: workflow.lastSavedAt
        } : null,
        nodes: transformedInstances.map((instance: any) => ({
            id: `node-${instance.id}`,
            agentId: instance.id,
            agentName: instance.name,
            position: instance.position || { x: 0, y: 0 },
            provider: instance.provider,
            model: instance.model,
            createdAt: instance.createdAt
        })),
        edges: edges.map(transformWorkflowEdgeForFrontend),
        agentInstances: transformedInstances,
        agentPrototypes: agentPrototypes.map(transformAgentPrototypeForFrontend),
        llmConfigs: llmConfigs.map((config: any) => ({
            id: config.id,
            provider: config.provider,
            enabled: config.enabled,
            hasApiKey: !!config.apiKeyEncrypted,
            capabilities: config.capabilities || {},
            updatedAt: config.updatedAt
        })),
        toolRuns: toolRuns.map(transformUserToolRunForFrontend),
        userSettings: {
            language: userSettings?.preferences?.language || 'fr',
            theme: userSettings?.preferences?.theme || 'dark'
        },
        metadata: {
            loadedAt: new Date(),
            userId,
            hasWorkflow: !!workflow,
            workflowWasCreated: wasCreated,
            healingActions: healingActions.length > 0 ? healingActions : undefined
        }
    };
}
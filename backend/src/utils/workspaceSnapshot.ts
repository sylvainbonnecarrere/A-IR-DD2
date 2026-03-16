import { AgentInstance } from '../models/AgentInstance.model';
import { AgentJournal } from '../models/AgentJournal.model';
import { AgentPrototype } from '../models/AgentPrototype.model';
import { LLMConfig } from '../models/LLMConfig.model';
import UserSettings from '../models/UserSettings.model';
import { WorkflowEdge } from '../models/WorkflowEdge.model';
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

export interface WorkspaceSnapshot {
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

    const [agentInstances, edges, journalEntries, agentPrototypes, llmConfigs, userSettings] = await Promise.all([
        workflowId ? AgentInstance.find({ workflowId }) : Promise.resolve([]),
        workflowId ? WorkflowEdge.find({ workflowId }) : Promise.resolve([]),
        workflowId ? AgentJournal.find({ workflowId, type: 'chat' }).sort({ timestamp: 1 }) : Promise.resolve([]),
        AgentPrototype.find({ userId, ...prototypeWorkflowFilter }).sort({ name: 1 }),
        LLMConfig.find({ userId }),
        UserSettings.findOne({ userId })
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
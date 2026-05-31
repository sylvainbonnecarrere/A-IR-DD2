import type { Node } from 'reactflow';
import type { Agent, AgentInstance, ResolvedAgentInstance, WorkflowNode, V2WorkflowNode } from '../types';

export interface ReactFlowAgentNodeData {
  robotId: string;
  label: string;
  agent: Agent | null;
  agentInstance?: AgentInstance | null;
  workflowId?: string;
}

export type CanvasWorkflowNode = WorkflowNode | V2WorkflowNode;

interface ProjectWorkflowNodeToReactFlowNodeParams {
  workflowNode: CanvasWorkflowNode;
  index: number;
  workflowId: string;
  agents?: Agent[];
  agentInstances?: AgentInstance[];
  resolveInstance?: (instanceId: string) => ResolvedAgentInstance | null | undefined;
}

interface ProjectWorkflowNodesToReactFlowNodesParams {
  workflowNodes: CanvasWorkflowNode[];
  workflowId: string;
  agents?: Agent[];
  agentInstances?: AgentInstance[];
  resolveInstance?: (instanceId: string) => ResolvedAgentInstance | null | undefined;
}

const DEFAULT_NODE_POSITION_ORIGIN = Object.freeze({ x: 100, y: 100 });
const DEFAULT_NODE_POSITION_STEP = Object.freeze({ x: 200, y: 150 });

function isV2CanvasWorkflowNode(node: CanvasWorkflowNode): node is V2WorkflowNode {
  return 'data' in node;
}

function getDefaultNodePosition(index: number) {
  return {
    x: DEFAULT_NODE_POSITION_ORIGIN.x + index * DEFAULT_NODE_POSITION_STEP.x,
    y: DEFAULT_NODE_POSITION_ORIGIN.y + index * DEFAULT_NODE_POSITION_STEP.y,
  };
}

function resolvePrototypeById(agents: Agent[], prototypeId?: string | null): Agent | null {
  if (!prototypeId) {
    return null;
  }

  return agents.find((candidate) => candidate.id === prototypeId) ?? null;
}

function ensureWorkflowScopedInstance(instance: AgentInstance | null | undefined, workflowId: string): AgentInstance | null {
  if (!instance) {
    return null;
  }

  if (instance.workflowId) {
    return instance;
  }

  return {
    ...instance,
    workflowId,
  };
}

export function projectWorkflowNodeToReactFlowNode({
  workflowNode,
  index,
  workflowId,
  agents = [],
  agentInstances = [],
  resolveInstance,
}: ProjectWorkflowNodeToReactFlowNodeParams): Node<ReactFlowAgentNodeData> {
  let nodeWorkflowId = workflowId;
  let position = workflowNode.position ?? getDefaultNodePosition(index);
  let agent: Agent | null = null;
  let agentInstance: AgentInstance | null = null;
  let robotId = 'unknown';

  if (isV2CanvasWorkflowNode(workflowNode)) {
    nodeWorkflowId = workflowNode.data.workflowId || workflowId;
    position = workflowNode.position || position;
    agentInstance = ensureWorkflowScopedInstance(workflowNode.data.agentInstance ?? null, nodeWorkflowId);
    agent = workflowNode.data.agent ?? resolvePrototypeById(agents, agentInstance?.prototypeId) ?? null;
    robotId = workflowNode.data.robotId || agent?.creator_id || 'unknown';
  } else {
    const resolved = workflowNode.instanceId ? resolveInstance?.(workflowNode.instanceId) : null;
    const directInstance = !resolved?.instance && workflowNode.instanceId
      ? agentInstances.find((candidate) => candidate.id === workflowNode.instanceId) ?? null
      : null;
    const resolvedWorkflowId = resolved?.instance.workflowId || directInstance?.workflowId || workflowId;

    position = workflowNode.position || position;
    agentInstance = ensureWorkflowScopedInstance(resolved?.instance ?? directInstance, resolvedWorkflowId);
    nodeWorkflowId = agentInstance?.workflowId || workflowId;
    agent = workflowNode.agent
      ?? resolved?.prototype
      ?? resolvePrototypeById(agents, agentInstance?.prototypeId)
      ?? null;
    robotId = workflowNode.agent?.id
      || resolved?.prototype?.creator_id
      || resolved?.prototype?.id
      || 'unknown';
  }

  return {
    id: workflowNode.id || `node-${index}`,
    type: 'customAgent',
    position,
    data: {
      robotId,
      label: agentInstance?.name || agent?.name || 'Agent',
      agent,
      agentInstance,
      workflowId: nodeWorkflowId,
    },
  };
}

export function projectWorkflowNodesToReactFlowNodes({
  workflowNodes,
  workflowId,
  agents = [],
  agentInstances = [],
  resolveInstance,
}: ProjectWorkflowNodesToReactFlowNodesParams): Node<ReactFlowAgentNodeData>[] {
  return workflowNodes.map((workflowNode, index) => projectWorkflowNodeToReactFlowNode({
    workflowNode,
    index,
    workflowId,
    agents,
    agentInstances,
    resolveInstance,
  }));
}
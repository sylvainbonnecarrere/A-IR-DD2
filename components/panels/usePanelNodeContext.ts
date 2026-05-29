import { useMemo } from 'react';
import type { Agent, AgentInstance, V2WorkflowNode } from '../../types';
import { useDesignStore } from '../../stores/useDesignStore';

interface UsePanelNodeContextOptions {
  nodeId?: string | null;
  agent?: Agent | null;
  agentInstance?: AgentInstance | null;
}

interface PanelNodeContext {
  normalizedNodeId: string | null;
  node: V2WorkflowNode | null;
  resolvedAgent: Agent | null;
  resolvedAgentInstance: AgentInstance | null;
}

const normalizeNodeId = (nodeId?: string | null): string | null => {
  if (!nodeId) {
    return null;
  }

  return nodeId.startsWith('node-') ? nodeId : `node-${nodeId}`;
};

const inferInstanceId = (nodeId?: string | null): string | null => {
  if (!nodeId) {
    return null;
  }

  return nodeId.startsWith('node-') ? nodeId.replace(/^node-/, '') : nodeId;
};

export const usePanelNodeContext = ({
  nodeId,
  agent,
  agentInstance,
}: UsePanelNodeContextOptions): PanelNodeContext => {
  const designNodes = useDesignStore((state) => state.nodes);
  const designAgents = useDesignStore((state) => state.agents);
  const designAgentInstances = useDesignStore((state) => state.agentInstances);

  return useMemo(() => {
    const normalizedNodeId = normalizeNodeId(nodeId);
    const node = normalizedNodeId
      ? designNodes.find((candidate) => candidate.id === normalizedNodeId) ?? null
      : null;
    const instanceId = agentInstance?.id ?? node?.data.agentInstance?.id ?? inferInstanceId(nodeId);
    const resolvedAgentInstance = agentInstance
      ?? node?.data.agentInstance
      ?? designAgentInstances.find((candidate) => candidate.id === instanceId)
      ?? null;
    const resolvedAgent = agent
      ?? node?.data.agent
      ?? (resolvedAgentInstance
        ? designAgents.find((candidate) => candidate.id === resolvedAgentInstance.prototypeId) ?? null
        : null);

    return {
      normalizedNodeId,
      node,
      resolvedAgent,
      resolvedAgentInstance,
    };
  }, [agent, agentInstance, designAgentInstances, designAgents, designNodes, nodeId]);
};
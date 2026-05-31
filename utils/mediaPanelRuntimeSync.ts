import { AgentInstance } from '../types';

type NodeScopedEditingImageInfo = {
  nodeId: string;
  agentInstance?: AgentInstance;
};

export function remapPanelNodeId(
  activeNodeId: string | null,
  fromNodeId: string,
  toNodeId: string,
): string | null {
  return activeNodeId === fromNodeId ? toNodeId : activeNodeId;
}

export function remapAgentInstanceReference(
  agentInstance: AgentInstance | null,
  fromInstanceId: string,
  toInstanceId: string,
  workflowId?: string,
): AgentInstance | null {
  if (!agentInstance || agentInstance.id !== fromInstanceId) {
    return agentInstance;
  }

  return {
    ...agentInstance,
    id: toInstanceId,
    ...(workflowId ? { workflowId } : {}),
  };
}

export function remapEditingImageInfo<T extends NodeScopedEditingImageInfo>(
  editingImageInfo: T | null,
  fromNodeId: string,
  toNodeId: string,
  fromInstanceId: string,
  toInstanceId: string,
  workflowId?: string,
): T | null {
  if (!editingImageInfo || editingImageInfo.nodeId !== fromNodeId) {
    return editingImageInfo;
  }

  const nextEditingImageInfo = {
    ...editingImageInfo,
    nodeId: toNodeId,
  } as T;

  if (editingImageInfo.agentInstance?.id === fromInstanceId) {
    nextEditingImageInfo.agentInstance = remapAgentInstanceReference(
      editingImageInfo.agentInstance,
      fromInstanceId,
      toInstanceId,
      workflowId,
    ) ?? undefined;
  }

  return nextEditingImageInfo;
}
import type { AgentBatchDeleteResult, AgentDeletionMediaPolicy } from '../types';
import apiClient from '../utils/apiClient';
import { PersistenceService } from './persistenceService';

export interface PersistNodePositionParams {
  nodeId: string;
  position: { x: number; y: number };
  instanceId?: string;
  isAuthenticated: boolean;
  accessToken?: string | null;
  updateNode: (nodeId: string, changes: { position: { x: number; y: number } }) => void;
  updateAgentInstance: (instanceId: string, changes: { position: { x: number; y: number } }) => void;
}

export async function persistNodePosition({
  nodeId,
  position,
  instanceId,
  isAuthenticated,
  accessToken,
  updateNode: _updateNode,
  updateAgentInstance: _updateAgentInstance,
}: PersistNodePositionParams): Promise<boolean> {
  if (!instanceId) {
    return false;
  }

  if (!isAuthenticated || !accessToken) {
    console.warn('[AppPersistenceService] Skipping node position persistence because the authenticated session has no access token yet:', {
      nodeId,
      instanceId,
    });
    return false;
  }

  try {
    const result = await PersistenceService.saveAgentInstance(
      {
        id: instanceId,
        position,
      },
      {
        isAuthenticated,
        accessToken,
      },
    );

    if (!result.success) {
      console.error('[AppPersistenceService] Failed to persist node position after drag-stop:', {
        nodeId,
        instanceId,
        position,
        error: result.error,
      });
      return false;
    }

    return true;
  } catch (error) {
    console.error('[AppPersistenceService] Unexpected error while persisting node position after drag-stop:', {
      nodeId,
      instanceId,
      position,
      error,
    });
    return false;
  }
}

export interface DeleteWorkflowInstanceParams {
  workflowId?: string | null;
  instanceId?: string;
  isAuthenticated: boolean;
  accessToken?: string | null;
}

export async function deleteWorkflowInstance({
  workflowId,
  instanceId,
  isAuthenticated,
  accessToken,
}: DeleteWorkflowInstanceParams): Promise<boolean> {
  if (!instanceId) {
    return false;
  }

  if (!isAuthenticated || !workflowId || !accessToken) {
    return true;
  }

  try {
    await apiClient.delete(`/api/workflows/${workflowId}/instances/${instanceId}`);
    return true;
  } catch (error) {
    console.error('[AppPersistenceService] Error deleting instance from backend:', error);
    return false;
  }
}

export interface DeleteWorkflowInstancesParams {
  workflowId?: string | null;
  instanceIds: string[];
  mediaPolicy?: AgentDeletionMediaPolicy;
  isAuthenticated: boolean;
  accessToken?: string | null;
  onDeleteLocalNode: (nodeId: string) => void;
  onDeleteLocalInstance: (instanceId: string) => void;
}

export async function deleteWorkflowInstances({
  workflowId,
  instanceIds,
  mediaPolicy = 'delete_media',
  isAuthenticated,
  accessToken,
  onDeleteLocalNode,
  onDeleteLocalInstance,
}: DeleteWorkflowInstancesParams): Promise<AgentBatchDeleteResult> {
  const failedInstanceIds: string[] = [];

  for (const instanceId of instanceIds) {
    let backendDeleted = true;

    if (isAuthenticated && workflowId && accessToken) {
      try {
        await apiClient.delete(`/api/workflows/${workflowId}/instances/${instanceId}`, {
          params: {
            mediaPolicy,
          },
        });
      } catch (error) {
        backendDeleted = false;
        failedInstanceIds.push(instanceId);
        console.error('[AppPersistenceService] Error deleting instance:', instanceId, error);
      }
    }

    if (!backendDeleted) {
      continue;
    }

    onDeleteLocalNode(`node-${instanceId}`);
    onDeleteLocalInstance(instanceId);
  }

  return failedInstanceIds.length > 0
    ? {
        success: false,
        failedInstanceIds,
        error: `${failedInstanceIds.length} instance(s) n'ont pas pu etre supprimees avec la politique media demandee.`,
      }
    : { success: true };
}

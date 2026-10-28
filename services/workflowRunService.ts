import apiClient from '../utils/apiClient';
import type { FunctionRunListResponse, FunctionRunRecord } from '../types/function.types';

export interface LaunchWorkflowRunPayload {
  workflowId?: string;
  functionId?: string;
  agentInstanceId?: string;
  toolSelection?: {
    toolId: string;
    versionRef?: {
      versionTag?: string;
      versionNumber?: number;
      workspaceId?: string | null;
    };
  };
  testArgs?: Record<string, unknown>;
  privateContext?: Record<string, unknown>;
}

export interface WorkflowRunServiceOptions {
  workflowId?: string;
  limit?: number;
  page?: number;
  status?: FunctionRunRecord['status'];
  sortBy?: 'createdAt' | 'durationMs' | 'status';
  sortOrder?: 'asc' | 'desc';
}

class WorkflowRunService {
  async listWorkflowRuns(workflowId: string, options: Omit<WorkflowRunServiceOptions, 'workflowId'> = {}): Promise<FunctionRunListResponse> {
    const response = await apiClient.get<FunctionRunListResponse>('/api/runs', {
      params: {
        workflowId,
        limit: options.limit ?? 20,
        page: options.page ?? 1,
        ...(options.status ? { status: options.status } : {}),
        ...(options.sortBy ? { sortBy: options.sortBy } : {}),
        ...(options.sortOrder ? { sortOrder: options.sortOrder } : {}),
      },
    });

    return response.data;
  }

  async launchRun(payload: LaunchWorkflowRunPayload): Promise<{ executionId: string; status: string; idempotency?: { key: string | null; replayed: boolean } }> {
    const response = await apiClient.post<{ executionId: string; status: string; idempotency?: { key: string | null; replayed: boolean } }>('/api/runs/execute', payload);
    return response.data;
  }

  async getRun(executionId: string, toolId?: string): Promise<FunctionRunRecord> {
    const response = await apiClient.get<FunctionRunRecord>(`/api/runs/executions/${executionId}`, {
      params: toolId ? { toolId } : undefined,
    });

    return response.data;
  }

  async cancelRun(executionId: string): Promise<{ success: boolean; executionId: string; status: string }> {
    const response = await apiClient.post<{ success: boolean; executionId: string; status: string }>(`/api/runs/executions/${executionId}/cancel`);
    return response.data;
  }
}

export default new WorkflowRunService();

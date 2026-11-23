import apiClient from '../utils/apiClient';
import type {
  CancelRunResponse,
  FenceAndRetryResponse,
  FunctionRunListResponse,
  FunctionRunRecord,
  RetryRunResponse,
  RunCommandErrorCode,
} from '../types/function.types';

/**
 * Erreur typée des commandes de run : conserve le statut HTTP et le `code`
 * du contrat serveur (409 RUN_NOT_CANCELLABLE / RUN_NOT_QUARANTINED /
 * WORKSPACE_LOCKED_BY_OTHER_RUN, 504 FENCING_TIMEOUT_ESCALATED, …) pour que
 * l'UI affiche l'état autoritaire sans rien masquer.
 */
export class RunCommandError extends Error {
  readonly status?: number;
  readonly code?: RunCommandErrorCode | string;

  constructor(message: string, status?: number, code?: RunCommandErrorCode | string) {
    super(message);
    this.name = 'RunCommandError';
    this.status = status;
    this.code = code;
  }
}

export const toRunCommandError = (error: unknown, fallbackMessage: string): RunCommandError => {
  if (error instanceof RunCommandError) {
    return error;
  }
  const axiosLike = error as { response?: { status?: number; data?: { error?: unknown; code?: unknown } }; message?: string } | null;
  const status = typeof axiosLike?.response?.status === 'number' ? axiosLike.response.status : undefined;
  const data = axiosLike?.response?.data;
  const code = data && typeof data.code === 'string' ? data.code : undefined;
  const message = data && typeof data.error === 'string' ? data.error : (axiosLike?.message ?? fallbackMessage);
  return new RunCommandError(message, status, code);
};

/** UUID v4 pour les clés d'idempotence (boutons Reset & Relance / Relancer). */
export const newIdempotencyKey = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

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

  async cancelRun(executionId: string): Promise<CancelRunResponse> {
    try {
      const response = await apiClient.post<CancelRunResponse>(`/api/runs/executions/${executionId}/cancel`);
      return response.data;
    } catch (error) {
      throw toRunCommandError(error, 'Annulation du run impossible');
    }
  }

  /**
   * Relance d'un run terminal : `POST /api/runs/executions/:executionId/retry`
   * (crée un NOUVEAU run `retryOfExecutionId`, jamais de `resume`). Requiert un
   * header `Idempotency-Key` (contrat US-J7-05).
   */
  async retryRun(executionId: string, idempotencyKey: string = newIdempotencyKey()): Promise<RetryRunResponse> {
    try {
      const response = await apiClient.post<RetryRunResponse>(
        `/api/runs/executions/${executionId}/retry`,
        {},
        { headers: { 'Idempotency-Key': idempotencyKey } },
      );
      return response.data;
    } catch (error) {
      throw toRunCommandError(error, 'Relance du run impossible');
    }
  }

  /**
   * Reset & Relance (US-J7-07) : `POST /api/workspaces/:workspaceId/runs/:runId/fence-and-retry`.
   * 202 = nouveau run créé, 200 = rejeu idempotent, 409/504 = refus contrat (voir `RunCommandError.code`).
   * Dans ce domaine `workspaceId === workflowId` (le workspace V2 est le workflow).
   */
  async fenceAndRetry(workspaceId: string, runId: string, idempotencyKey: string = newIdempotencyKey()): Promise<FenceAndRetryResponse> {
    try {
      const response = await apiClient.post<FenceAndRetryResponse>(
        `/api/workspaces/${workspaceId}/runs/${runId}/fence-and-retry`,
        {},
        { headers: { 'Idempotency-Key': idempotencyKey } },
      );
      return response.data;
    } catch (error) {
      throw toRunCommandError(error, 'Reset & relance impossible');
    }
  }
}

export default new WorkflowRunService();

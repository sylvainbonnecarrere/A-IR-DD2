import { API_BASE_URL } from '../config/api.config';

export type WorkflowMediaStorageMode = 'db' | 'workspace' | 'cloud';
export type WorkflowMediaSortBy = 'updatedAt' | 'createdAt' | 'name' | 'size';
export type WorkflowMediaSortOrder = 'asc' | 'desc';

export interface WorkflowMediaExplorerItem {
  mediaId: string;
  workflowId: string;
  storageMode: WorkflowMediaStorageMode;
  canonicalLocator: string;
  displayName: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  updatedAt: string;
  createdByAgentId: string | null;
  createdByAgentName: string | null;
  lastModifiedByAgentId: string | null;
  lastModifiedByAgentName: string | null;
  isOrphan: boolean;
  orphanReason: string | null;
}

export interface WorkflowMediaExplorerResponse {
  data: WorkflowMediaExplorerItem[];
  meta: {
    total: number;
    counts: Record<WorkflowMediaStorageMode, number>;
  };
}

export interface DeleteWorkflowMediaResponse {
  success: boolean;
  message: string;
  fileDeleted: boolean;
}

interface WorkflowMediaExplorerOptions {
  token: string;
  q?: string;
  includeOrphans?: boolean;
  sortBy?: WorkflowMediaSortBy;
  sortOrder?: WorkflowMediaSortOrder;
  storageMode?: WorkflowMediaStorageMode;
}

export const workflowMediaExplorerService = {
  async getWorkflowMedia(
    workflowId: string,
    options: WorkflowMediaExplorerOptions,
  ): Promise<WorkflowMediaExplorerResponse> {
    const searchParams = new URLSearchParams();

    if (options.q?.trim()) {
      searchParams.set('q', options.q.trim());
    }

    if (options.includeOrphans) {
      searchParams.set('includeOrphans', 'true');
    }

    if (options.sortBy) {
      searchParams.set('sortBy', options.sortBy);
    }

    if (options.sortOrder) {
      searchParams.set('sortOrder', options.sortOrder);
    }

    if (options.storageMode) {
      searchParams.set('storageMode', options.storageMode);
    }

    const response = await fetch(
      `${API_BASE_URL}/api/media/workflows/${workflowId}/explorer?${searchParams.toString()}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${options.token}`,
          'Content-Type': 'application/json',
        },
      },
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || `Workflow media request failed: ${response.status}`);
    }

    return response.json();
  },

  async getMediaBlob(
    mediaId: string,
    options: { token: string; download?: boolean },
  ): Promise<Blob> {
    const searchParams = new URLSearchParams();
    if (options.download) {
      searchParams.set('download', 'true');
    }

    const queryString = searchParams.toString();
    const response = await fetch(
      `${API_BASE_URL}/api/media/${mediaId}${queryString ? `?${queryString}` : ''}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${options.token}`,
        },
      },
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || `Media request failed: ${response.status}`);
    }

    return response.blob();
  },

  async deleteMedia(
    mediaId: string,
    options: { token: string },
  ): Promise<DeleteWorkflowMediaResponse> {
    const response = await fetch(`${API_BASE_URL}/api/media/${mediaId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${options.token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || `Media delete failed: ${response.status}`);
    }

    return response.json();
  },
};
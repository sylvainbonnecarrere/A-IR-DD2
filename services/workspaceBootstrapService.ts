import apiClient from '../utils/apiClient';
import { getErrorMessage, isTransientNetworkError } from '../utils/transientNetworkError';
import type { RuntimeBootstrapState } from './runtimeBootstrapService';

export interface WorkspaceSnapshot {
    workflow: {
        id: string;
        name: string;
        description?: string;
        isActive: boolean;
        isDefault: boolean;
        canvasState?: {
            zoom: number;
            panX: number;
            panY: number;
        };
    } | null;
    nodes?: any[];
    edges?: any[];
    agentInstances?: any[];
    agentPrototypes?: any[];
}

export interface WorkspaceBootstrapIssue {
    scope: 'runtime' | 'workspace';
    transient: boolean;
    message: string;
    error: unknown;
}

export interface AuthenticatedWorkspaceBootstrapResult {
    workspace: WorkspaceSnapshot;
    runtimeState: RuntimeBootstrapState | null;
    runtimeIssue: WorkspaceBootstrapIssue | null;
}

export async function fetchWorkspaceSnapshot(): Promise<WorkspaceSnapshot> {
    const { data } = await apiClient.get<WorkspaceSnapshot>('/api/user/workspace');
    return data;
}

export function createWorkspaceBootstrapIssue(
    scope: WorkspaceBootstrapIssue['scope'],
    error: unknown,
): WorkspaceBootstrapIssue {
    return {
        scope,
        transient: isTransientNetworkError(error),
        message: getErrorMessage(error),
        error,
    };
}

export function logWorkspaceBootstrapIssue(
    prefix: string,
    issue: WorkspaceBootstrapIssue,
    details?: Record<string, unknown>,
): void {
    const log = issue.transient ? console.warn : console.error;
    log(`${prefix} ${issue.scope} bootstrap ${issue.transient ? 'degraded' : 'failed'}: ${issue.message}`, details ?? issue.error);
}

export async function loadAuthenticatedWorkspaceBootstrap(params: {
    loadRuntimeState: () => Promise<RuntimeBootstrapState | null>;
}): Promise<AuthenticatedWorkspaceBootstrapResult> {
    const [workspaceResult, runtimeResult] = await Promise.allSettled([
        fetchWorkspaceSnapshot(),
        params.loadRuntimeState(),
    ]);

    if (workspaceResult.status === 'rejected') {
        throw workspaceResult.reason;
    }

    if (runtimeResult.status === 'rejected') {
        return {
            workspace: workspaceResult.value,
            runtimeState: null,
            runtimeIssue: createWorkspaceBootstrapIssue('runtime', runtimeResult.reason),
        };
    }

    return {
        workspace: workspaceResult.value,
        runtimeState: runtimeResult.value,
        runtimeIssue: null,
    };
}
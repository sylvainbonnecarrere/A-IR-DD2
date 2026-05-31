import type { AuthSessionStatus } from '../contexts/types/auth.types';

interface WorkspaceSessionGateInput {
    isAuthenticated: boolean;
    accessToken?: string | null;
    sessionStatus?: AuthSessionStatus;
    userId?: string | null;
    authLoading?: boolean;
}

interface WorkspaceSessionGateState {
    sessionReadyForWorkspaceHydration: boolean;
    awaitingStableAuthenticatedSession: boolean;
    stableWorkspaceIdentity: string | null;
}

export const getWorkspaceSessionGateState = ({
    isAuthenticated,
    accessToken,
    sessionStatus,
    userId,
    authLoading = false
}: WorkspaceSessionGateInput): WorkspaceSessionGateState => {
    const hasStableAuthenticatedSession = !authLoading
        && isAuthenticated
        && sessionStatus === 'ready'
        && Boolean(accessToken)
        && Boolean(userId);

    const awaitingStableAuthenticatedSession = !authLoading
        && isAuthenticated
        && !hasStableAuthenticatedSession;

    return {
        sessionReadyForWorkspaceHydration: hasStableAuthenticatedSession,
        awaitingStableAuthenticatedSession,
        stableWorkspaceIdentity: hasStableAuthenticatedSession
            ? `auth:${userId}`
            : !authLoading && !isAuthenticated
                ? 'guest'
                : null
    };
};
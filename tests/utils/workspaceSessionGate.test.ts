import { getWorkspaceSessionGateState } from '../../utils/workspaceSessionGate';

describe('workspaceSessionGate', () => {
  it('marks an authenticated but not yet ready session as awaiting stabilization', () => {
    expect(getWorkspaceSessionGateState({
      isAuthenticated: true,
      accessToken: 'token-123',
      sessionStatus: 'loading',
      userId: 'user-1',
      authLoading: false,
    })).toEqual(expect.objectContaining({
      sessionReadyForWorkspaceHydration: false,
      awaitingStableAuthenticatedSession: true,
      stableWorkspaceIdentity: null,
    }));
  });

  it('marks a fully ready authenticated session as hydration-ready', () => {
    expect(getWorkspaceSessionGateState({
      isAuthenticated: true,
      accessToken: 'token-123',
      sessionStatus: 'ready',
      userId: 'user-1',
      authLoading: false,
    })).toEqual(expect.objectContaining({
      sessionReadyForWorkspaceHydration: true,
      awaitingStableAuthenticatedSession: false,
      stableWorkspaceIdentity: 'auth:user-1',
    }));
  });

  it('keeps guest identity when not authenticated', () => {
    expect(getWorkspaceSessionGateState({
      isAuthenticated: false,
      accessToken: null,
      sessionStatus: 'ready',
      userId: null,
      authLoading: false,
    })).toEqual(expect.objectContaining({
      sessionReadyForWorkspaceHydration: false,
      awaitingStableAuthenticatedSession: false,
      stableWorkspaceIdentity: 'guest',
    }));
  });
});
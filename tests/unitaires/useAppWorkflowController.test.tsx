import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useAppWorkflowController } from '../../hooks/useAppWorkflowController';
import apiClient from '../../utils/apiClient';

jest.mock('../../stores/useDesignStore', () => ({
  useDesignStore: Object.assign(
    () => ({ currentWorkflowId: 'wf-1' }),
    {
      getState: () => ({
        currentWorkflowId: 'wf-1',
        loadUserWorkflows: jest.fn().mockResolvedValue(undefined),
      }),
    },
  ),
}));

jest.mock('../../utils/apiClient', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
  },
}));

jest.mock('../../hooks/useWorkspaceHydrationOrchestrator', () => ({
  useWorkspaceHydrationOrchestrator: () => ({
    beginBlockingHydrationVisualGate: jest.fn(),
    completeBlockingHydrationVisualGate: jest.fn(),
    awaitingBlockingHydrationVisualGate: false,
    hydrateInteractiveWorkspaceState: jest.fn().mockResolvedValue('wf-1'),
    hydrationMessage: 'Hydrating',
    hydrationProgress: 50,
    isBlockingHydration: false,
    isPreparingBlockingHydration: false,
    isHydrating: false,
    resumeWorkspaceSilently: jest.fn(),
    sessionReadyForWorkspaceHydration: true,
  }),
}));

const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;

function TestHarness() {
  const { switchToWorkflow, isSwitchingWorkflow } = useAppWorkflowController({
    accessToken: 'token-123',
    authError: null,
    authLoading: false,
    isAuthenticated: true,
    refreshRuntimeConfigState: jest.fn(),
    sessionStatus: 'active',
    userId: 'user-1',
    currentRouteUsesWorkflowCanvas: true,
    t: (key: string) => key,
  });

  return (
    <button type="button" onClick={() => switchToWorkflow('wf-1', 'Workflow A')}>
      {isSwitchingWorkflow ? 'switching' : 'idle'}
    </button>
  );
}

describe('useAppWorkflowController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPost.mockResolvedValue({
      data: {
        success: true,
        reloadedData: {
          workflow: { id: 'wf-1', name: 'Workflow A' },
          agentPrototypes: [],
          agentInstances: [],
          edges: [],
        },
      },
    });
  });

  it('switches to a workflow by posting the selected workflow snapshot', async () => {
    const designStoreMock = require('../../stores/useDesignStore').useDesignStore;
    designStoreMock.getState = jest.fn(() => ({ currentWorkflowId: null }));

    render(<TestHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'idle' }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/api/workflows/wf-1/select');
    });
  });

  it('skips the select request when the workflow is already active', async () => {
    const designStoreMock = require('../../stores/useDesignStore').useDesignStore;
    designStoreMock.getState = jest.fn(() => ({ currentWorkflowId: 'wf-1' }));

    render(<TestHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'idle' }));

    await waitFor(() => {
      expect(mockPost).not.toHaveBeenCalled();
    });
  });
});

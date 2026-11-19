import React from 'react';

import { render, screen } from '@testing-library/react';

import { WorkflowToolbar } from '../../components/workflow/WorkflowToolbar';

import WorkflowRunService from '../../services/workflowRunService';


let mockStoreState = {
  currentWorkflow: { id: 'wf-1', name: 'Demo workflow', description: '' },
  execution: null as null | { id: string; workflowId: string; status: string; startedAt: string; results: Record<string, unknown>; errors: Record<string, unknown> },
  executeWorkflow: jest.fn(),
  toggleConfigPanel: jest.fn(),
  isConfigPanelOpen: false,
};

const mockDesignState = {
  nodes: [{ id: 'n-1', type: 'archi', position: { x: 0, y: 0 }, data: { label: 'Node 1', type: 'agent' } }],
  edges: [],
  currentWorkflowId: 'wf-1' as string | null,
  workflows: [{ _id: 'wf-1', name: 'Demo workflow' }],
};

// ⭐ US-J7-13: état d'observation runtime pilotable par test
let mockRunStatus = {
  runId: null as string | null,
  status: null as string | null,
  lockHeld: false,
  syncState: 'ready' as 'loading' | 'ready' | 'error' | null,
  connectionState: 'connected',
};

const mockRefresh = jest.fn();
const mockCommandModals = {
  requestCancel: jest.fn(),
  requestResetAndRelaunch: jest.fn(),
  relaunch: jest.fn(),
  openRunDetail: jest.fn(),
  openRunHistory: jest.fn(),
  closeRunHistory: jest.fn(),
  isHistoryOpen: false,
  actionErrorCode: null as string | null,
  clearActionError: jest.fn(),
  successMessageKey: null as string | null,
  isSubmitting: false,
  modals: null as React.ReactNode,
};

jest.mock('../../stores/useDesignStore', () => ({
  useDesignStore: (selector?: (state: typeof mockDesignState) => unknown) => (
    selector ? selector(mockDesignState) : mockDesignState
  ),
}));

jest.mock('../../hooks/useLocalization', () => ({
  useLocalization: () => ({
    t: (key: string, fallback?: string | Record<string, string | number>) => (typeof fallback === 'string' ? fallback : key),
  }),
}));

jest.mock('../../services/workflowRunService', () => ({
  __esModule: true,
  default: {
    listWorkflowRuns: jest.fn(),
    launchRun: jest.fn(),
    cancelRun: jest.fn(),
    retryRun: jest.fn(),
    fenceAndRetry: jest.fn(),
  },
  newIdempotencyKey: jest.fn(() => 'idem-test-key'),
  RunCommandError: class RunCommandError extends Error {
    status?: number;
    code?: string;
    constructor(message: string, status?: number, code?: string) {
      super(message);
      this.name = 'RunCommandError';
      this.status = status;
      this.code = code;
    }
  },
}));

jest.mock('../../stores/useWorkflowStore', () => ({
  useWorkflowStore: (selector?: (state: typeof mockStoreState) => unknown) => {
    const state = (globalThis as typeof globalThis & { __mockStoreState?: typeof mockStoreState }).__mockStoreState ?? mockStoreState;
    return selector ? selector(state) : state;
  },
}));

jest.mock('../../hooks/useWorkflowRuntimeState', () => ({
  useWorkflowRunSync: () => ({ refresh: mockRefresh }),
  useWorkflowRunStatus: () => mockRunStatus,
  useInstanceRunStatus: () => null,
}));

jest.mock('../../hooks/useRunCommandModals', () => ({
  useRunCommandModals: () => mockCommandModals,
}));

const mockedWorkflowRunService = WorkflowRunService as jest.Mocked<typeof WorkflowRunService>;

describe('WorkflowToolbar runtime gating (US-J7-13)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDesignState.nodes = [{ id: 'n-1', type: 'archi', position: { x: 0, y: 0 }, data: { label: 'Node 1', type: 'agent' } }];
    mockDesignState.currentWorkflowId = 'wf-1';
    mockStoreState = {
      currentWorkflow: { id: 'wf-1', name: 'Demo workflow', description: '' },
      execution: null,
      executeWorkflow: jest.fn(),
      toggleConfigPanel: jest.fn(),
      isConfigPanelOpen: false,
    };
    (globalThis as typeof globalThis & { __mockStoreState?: typeof mockStoreState }).__mockStoreState = mockStoreState;
    mockRunStatus = { runId: null, status: null, lockHeld: false, syncState: 'ready', connectionState: 'connected' };
    mockedWorkflowRunService.listWorkflowRuns.mockResolvedValue({
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0, sortBy: 'createdAt', sortOrder: 'desc' },
    });
  });

  it('enables launch when the workflow is idle and the backend is ready', async () => {
    render(<WorkflowToolbar />);

    const executeButton = await screen.findByRole('button', { name: 'workflow.execute' });
    expect(executeButton).toBeEnabled();
    // Pas de Pause/Reprendre (contrat V2) ; pas d'Annuler sans run actif.
    expect(screen.queryByRole('button', { name: 'workflow.pause' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'workflow.resume' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'workflow.cancel' })).toBeNull();
  });

  it('disables launch when the V2 design graph has no node', async () => {
    mockDesignState.nodes = [];

    render(<WorkflowToolbar />);

    expect(await screen.findByRole('button', { name: 'workflow.execute' })).toBeDisabled();
  });

  it('disables launch and exposes cancel (with confirmation) while a run is active', async () => {
    mockRunStatus = { runId: 'run-1', status: 'running', lockHeld: false, syncState: 'ready', connectionState: 'connected' };
    mockStoreState = {
      ...mockStoreState,
      execution: { id: 'run-1', workflowId: 'wf-1', status: 'running', startedAt: '2026-01-01T00:00:00.000Z', results: {}, errors: {} },
    };
    (globalThis as typeof globalThis & { __mockStoreState?: typeof mockStoreState }).__mockStoreState = mockStoreState;

    render(<WorkflowToolbar />);

    const executeButton = await screen.findByRole('button', { name: 'workflow.execute' });
    expect(executeButton).toBeDisabled();

    const cancelButton = screen.getByRole('button', { name: 'workflow.cancel' });
    expect(cancelButton).toBeEnabled();
    // La confirmation est exigée avant toute commande : aucun appel serveur à ce stade.
    cancelButton.click();
    expect(mockCommandModals.requestCancel).toHaveBeenCalledWith('run-1');
    expect(mockedWorkflowRunService.cancelRun).not.toHaveBeenCalled();
  });

  it('shows Reset & Relance (not Relaunch) when the run is quarantined with the lock held', async () => {
    mockRunStatus = { runId: 'run-9', status: 'quarantined', lockHeld: true, syncState: 'ready', connectionState: 'connected' };

    render(<WorkflowToolbar />);

    expect(await screen.findByTestId('reset-and-relaunch-button')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'workflow.relaunch' })).toBeNull();
    expect(screen.getByTestId('workflow-run-status')).toHaveAttribute('data-status', 'quarantined');
  });

  it('shows Relaunch for a terminal non-quarantined run', async () => {
    mockRunStatus = { runId: 'run-7', status: 'failed', lockHeld: false, syncState: 'ready', connectionState: 'connected' };

    render(<WorkflowToolbar />);

    const relaunchButton = await screen.findByRole('button', { name: 'workflow.relaunch' });
    expect(relaunchButton).toBeEnabled();
    expect(screen.queryByTestId('reset-and-relaunch-button')).toBeNull();
  });

  it('disables launch and shows the offline LED (with hover bubble) when the realtime channel is offline', async () => {
    mockRunStatus = { runId: null, status: null, lockHeld: false, syncState: 'ready', connectionState: 'offline' };

    render(<WorkflowToolbar />);

    expect(await screen.findByRole('button', { name: 'workflow.execute' })).toBeDisabled();
    // ⭐ plus de bandeau/ligne dédiée : une diode devant « workflow actuel » + bulle au survol
    const led = screen.getByTestId('workflow-connection-led');
    expect(led).toHaveAttribute('data-connection', 'offline');
    expect(led).toHaveAttribute('role', 'status');
    expect(screen.queryByTestId('workflow-connection-banner')).toBeNull();
    expect(screen.getByTestId('workflow-connection-bubble')).toHaveTextContent('workflow.connectionLed.hint');
  });
});

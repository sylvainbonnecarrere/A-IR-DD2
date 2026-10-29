import React from 'react';
import { render, screen } from '@testing-library/react';
import { WorkflowToolbar } from '../../components/workflow/WorkflowToolbar';
import WorkflowRunService from '../../services/workflowRunService';

let mockStoreState = {
  currentWorkflow: { id: 'wf-1', name: 'Demo workflow', description: '' },
  execution: null,
  executeWorkflow: jest.fn(),
  pauseExecution: jest.fn(),
  stopExecution: jest.fn(),
  toggleConfigPanel: jest.fn(),
  isConfigPanelOpen: false,
};

const mockDesignState = {
  nodes: [{ id: 'n-1', type: 'archi', position: { x: 0, y: 0 }, data: { label: 'Node 1', type: 'agent' } }],
  edges: [],
};

jest.mock('../../stores/useDesignStore', () => ({
  useDesignStore: (selector?: (state: typeof mockDesignState) => unknown) => (
    selector ? selector(mockDesignState) : mockDesignState
  ),
}));

jest.mock('../../hooks/useLocalization', () => ({
  useLocalization: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

jest.mock('../../services/workflowRunService', () => ({
  __esModule: true,
  default: {
    listWorkflowRuns: jest.fn(),
  },
}));

jest.mock('../../stores/useWorkflowStore', () => ({
  useWorkflowStore: (selector?: (state: typeof mockStoreState) => unknown) => {
    const state = (globalThis as typeof globalThis & { __mockStoreState?: typeof mockStoreState }).__mockStoreState ?? mockStoreState;
    return selector ? selector(state) : state;
  },
}));

const mockedWorkflowRunService = WorkflowRunService as jest.Mocked<typeof WorkflowRunService>;

describe('WorkflowToolbar runtime gating', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDesignState.nodes = [{ id: 'n-1', type: 'archi', position: { x: 0, y: 0 }, data: { label: 'Node 1', type: 'agent' } }];
    mockStoreState = {
      currentWorkflow: { id: 'wf-1', name: 'Demo workflow', description: '' },
      execution: null,
      executeWorkflow: jest.fn(),
      pauseExecution: jest.fn(),
      stopExecution: jest.fn(),
      toggleConfigPanel: jest.fn(),
      isConfigPanelOpen: false,
    };
    (globalThis as typeof globalThis & { __mockStoreState?: typeof mockStoreState }).__mockStoreState = mockStoreState;
    mockedWorkflowRunService.listWorkflowRuns.mockResolvedValue({
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0, sortBy: 'createdAt', sortOrder: 'desc' },
    });
  });

  it('enables launch when the workflow is idle and the backend is ready', async () => {
    render(<WorkflowToolbar />);

    const executeButton = await screen.findByRole('button', { name: /Execute/i });
    expect(executeButton).toBeEnabled();
  });

  it('disables launch when the V2 design graph has no node', async () => {
    mockDesignState.nodes = [];

    render(<WorkflowToolbar />);

    expect(await screen.findByRole('button', { name: /Execute/i })).toBeDisabled();
  });

  it('disables launch and exposes stop controls while a run is active', async () => {
    mockStoreState = { ...mockStoreState, execution: { id: 'run-1', workflowId: 'wf-1', status: 'running', startedAt: '2026-01-01T00:00:00.000Z', results: {}, errors: {} } };
    (globalThis as typeof globalThis & { __mockStoreState?: typeof mockStoreState }).__mockStoreState = mockStoreState;
    mockedWorkflowRunService.listWorkflowRuns.mockResolvedValue({
      items: [{ executionId: 'run-1', status: 'running', runtime: 'python', runner: 'docker_sandbox', launchContext: 'workflow_run', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', timing: { startedAt: '2026-01-01T00:00:00.000Z' } }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1, sortBy: 'createdAt', sortOrder: 'desc' },
    });

    render(<WorkflowToolbar />);

    const executeButton = await screen.findByRole('button', { name: /Execute/i });
    expect(executeButton).toBeDisabled();
    expect(screen.getByRole('button', { name: /Pause/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Stop/i })).toBeEnabled();
  });

  it('shows a resume action when the run is stopped', async () => {
    mockStoreState = { ...mockStoreState, execution: { id: 'run-1', workflowId: 'wf-1', status: 'stopped', startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:05.000Z', results: {}, errors: {} } };
    (globalThis as typeof globalThis & { __mockStoreState?: typeof mockStoreState }).__mockStoreState = mockStoreState;
    mockedWorkflowRunService.listWorkflowRuns.mockResolvedValue({
      items: [{ executionId: 'run-1', status: 'stopped', runtime: 'python', runner: 'docker_sandbox', launchContext: 'workflow_run', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', timing: { finishedAt: '2026-01-01T00:00:05.000Z' } }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1, sortBy: 'createdAt', sortOrder: 'desc' },
    });

    render(<WorkflowToolbar />);

    expect(await screen.findByRole('button', { name: /Resume/i })).toBeEnabled();
  });
});

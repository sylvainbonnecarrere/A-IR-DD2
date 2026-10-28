import apiClient from '../../utils/apiClient';
import WorkflowRunService from '../../services/workflowRunService';

describe('WorkflowRunService V2 contract bridge', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('lists workflow-scoped runs through the canonical /api/runs route', async () => {
    jest.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        items: [{
          executionId: 'run-1',
          status: 'running',
          runtime: 'python',
          runner: 'docker_sandbox',
          launchContext: 'workflow_run',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:10.000Z',
          timing: { startedAt: '2026-01-01T00:00:01.000Z' },
        }],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          totalPages: 1,
          sortBy: 'createdAt',
          sortOrder: 'desc',
        },
      },
    });

    const result = await WorkflowRunService.listWorkflowRuns('wf-123');

    expect(apiClient.get).toHaveBeenCalledWith('/api/runs', {
      params: {
        workflowId: 'wf-123',
        limit: 20,
        page: 1,
      },
    });
    expect(result.items[0].status).toBe('running');
    expect(result.items[0].launchContext).toBe('workflow_run');
  });

  it('launches a run through the canonical execute endpoint using workflow context', async () => {
    jest.spyOn(apiClient, 'post').mockResolvedValue({
      data: {
        executionId: 'run-456',
        status: 'queued',
        idempotency: { key: null, replayed: false },
      },
    });

    const result = await WorkflowRunService.launchRun({
      workflowId: 'wf-123',
      agentInstanceId: 'instance-22',
      functionId: 'tool-99',
      testArgs: { input: 'hello' },
      privateContext: { workflowId: 'wf-123' },
    });

    expect(apiClient.post).toHaveBeenCalledWith('/api/runs/execute', expect.objectContaining({
      functionId: 'tool-99',
      agentInstanceId: 'instance-22',
      testArgs: { input: 'hello' },
      privateContext: expect.objectContaining({ workflowId: 'wf-123' }),
    }));
    expect(result.executionId).toBe('run-456');
    expect(result.status).toBe('queued');
  });

  it('reads a run by executionId through the canonical details route', async () => {
    jest.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        executionId: 'run-789',
        status: 'running',
        toolId: 'tool-99',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:05.000Z',
      },
    });

    const result = await WorkflowRunService.getRun('run-789', 'tool-99');

    expect(apiClient.get).toHaveBeenCalledWith('/api/runs/executions/run-789', {
      params: { toolId: 'tool-99' },
    });
    expect(result.status).toBe('running');
    expect(result.executionId).toBe('run-789');
  });

  it('cancels a queued or running run via the execution cancel route', async () => {
    jest.spyOn(apiClient, 'post').mockResolvedValue({
      data: { success: true, executionId: 'run-cancelled', status: 'stopped' },
    });

    const result = await WorkflowRunService.cancelRun('run-cancelled');

    expect(apiClient.post).toHaveBeenCalledWith('/api/runs/executions/run-cancelled/cancel');
    expect(result.status).toBe('stopped');
    expect(result.success).toBe(true);
  });
});

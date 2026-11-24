import type { AxiosResponse } from 'axios';
import apiClient from '../../utils/apiClient';
import WorkflowRunService from '../../services/workflowRunService';

// ⭐ hygiène tsc : construit une AxiosResponse complète et typée à partir du body { data }
// (les mocks partiels ne sont plus assignables au contrat d'axios).
const okResponse = <T>(body: { data: T }): AxiosResponse<T> => ({
  ...body,
  status: 200,
  statusText: 'OK',
  headers: {},
  config: {} as AxiosResponse<T>['config'],
});

describe('WorkflowRunService V2 contract bridge', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('lists workflow-scoped runs through the canonical /api/runs route', async () => {
    jest.spyOn(apiClient, 'get').mockResolvedValue(
      okResponse({
        data: {
          items: [
            {
              executionId: 'run-1',
              status: 'running',
              runtime: 'python',
              runner: 'docker_sandbox',
              launchContext: 'workflow_run',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:10.000Z',
              timing: { startedAt: '2026-01-01T00:00:01.000Z' },
            },
          ],
          pagination: {
            page: 1,
            limit: 20,
            total: 1,
            totalPages: 1,
            sortBy: 'createdAt',
            sortOrder: 'desc',
          },
        },
      }),
    );

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
    jest.spyOn(apiClient, 'post').mockResolvedValue(
      okResponse({
        data: {
          executionId: 'run-456',
          status: 'queued',
          idempotency: { key: null, replayed: false },
        },
      }),
    );

    const result = await WorkflowRunService.launchRun({
      workflowId: 'wf-123',
      agentInstanceId: 'instance-22',
      functionId: 'tool-99',
      testArgs: { input: 'hello' },
      privateContext: { workflowId: 'wf-123' },
    });

    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/runs/execute',
      expect.objectContaining({
        functionId: 'tool-99',
        agentInstanceId: 'instance-22',
        testArgs: { input: 'hello' },
        privateContext: expect.objectContaining({ workflowId: 'wf-123' }),
      }),
    );
    expect(result.executionId).toBe('run-456');
    expect(result.status).toBe('queued');
  });

  it('reads a run by executionId through the canonical details route', async () => {
    jest.spyOn(apiClient, 'get').mockResolvedValue(
      okResponse({
        data: {
          executionId: 'run-789',
          status: 'running',
          toolId: 'tool-99',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:05.000Z',
        },
      }),
    );

    const result = await WorkflowRunService.getRun('run-789', 'tool-99');

    expect(apiClient.get).toHaveBeenCalledWith('/api/runs/executions/run-789', {
      params: { toolId: 'tool-99' },
    });
    expect(result.status).toBe('running');
    expect(result.executionId).toBe('run-789');
  });

  it('cancels a queued or running run via the execution cancel route', async () => {
    jest.spyOn(apiClient, 'post').mockResolvedValue(
      okResponse({
        data: { success: true, executionId: 'run-cancelled', status: 'stopped' },
      }),
    );

    const result = await WorkflowRunService.cancelRun('run-cancelled');

    expect(apiClient.post).toHaveBeenCalledWith('/api/runs/executions/run-cancelled/cancel');
    expect(result.status).toBe('stopped');
    expect(result.success).toBe(true);
  });

  it('retryRun appelle POST /api/runs/executions/:id/retry avec un header Idempotency-Key', async () => {
    jest.spyOn(apiClient, 'post').mockResolvedValue({
      data: { executionId: 'run-new', retryOfExecutionId: 'run-7', status: 'queued' },
    } as never);

    const result = await WorkflowRunService.retryRun('run-7', 'idem-uuid-1');

    expect(apiClient.post).toHaveBeenCalledWith('/api/runs/executions/run-7/retry', {}, { headers: { 'Idempotency-Key': 'idem-uuid-1' } });
    expect(result.executionId).toBe('run-new');
    expect(result.retryOfExecutionId).toBe('run-7');
    expect(result.status).toBe('queued');
  });

  it('retryRun génère une clé d’idempotence uuid v4 par défaut', async () => {
    jest.spyOn(apiClient, 'post').mockResolvedValue({
      data: { executionId: 'run-new', retryOfExecutionId: 'run-7', status: 'queued' },
    } as never);

    await WorkflowRunService.retryRun('run-7');

    const [, , config] = (apiClient.post as jest.Mock).mock.calls[0];
    expect(config.headers['Idempotency-Key']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('retryRun mappe une erreur axios en RunCommandError (status + code contrat)', async () => {
    jest.spyOn(apiClient, 'post').mockRejectedValue({
      response: { status: 409, data: { error: 'Run not retryable', code: 'RUN_NOT_RETRYABLE' } },
      message: 'Request failed with status code 409',
    });

    await expect(WorkflowRunService.retryRun('run-7', 'k')).rejects.toMatchObject({
      name: 'RunCommandError',
      status: 409,
      code: 'RUN_NOT_RETRYABLE',
      message: 'Run not retryable',
    });
  });

  it('fenceAndRetry appelle POST /api/workspaces/:workspaceId/runs/:runId/fence-and-retry (202)', async () => {
    jest.spyOn(apiClient, 'post').mockResolvedValue({
      status: 202,
      data: { fencedRunId: 'run-9', newExecutionId: 'run-10', status: 'queued', recoveryAttemptCount: 1 },
    } as never);

    const result = await WorkflowRunService.fenceAndRetry('wf-1', 'run-9', 'idem-uuid-2');

    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/workspaces/wf-1/runs/run-9/fence-and-retry',
      {},
      { headers: { 'Idempotency-Key': 'idem-uuid-2' } },
    );
    expect(result.fencedRunId).toBe('run-9');
    expect(result.newExecutionId).toBe('run-10');
    expect(result.status).toBe('queued');
    expect(result.recoveryAttemptCount).toBe(1);
  });

  it.each([
    [409, 'RUN_NOT_QUARANTINED'],
    [409, 'WORKSPACE_LOCKED_BY_OTHER_RUN'],
    [504, 'FENCING_TIMEOUT_ESCALATED'],
  ])('fenceAndRetry propage le refus contrat %s %s via RunCommandError', async (status, code) => {
    jest.spyOn(apiClient, 'post').mockRejectedValue({
      response: { status, data: { error: `refus ${code}`, code } },
      message: 'Request failed',
    });

    await expect(WorkflowRunService.fenceAndRetry('wf-1', 'run-9', 'k')).rejects.toMatchObject({
      name: 'RunCommandError',
      status,
      code,
    });
  });

  it('cancelRun mappe un 409 RUN_NOT_CANCELLABLE en RunCommandError typé', async () => {
    jest.spyOn(apiClient, 'post').mockRejectedValue({
      response: { status: 409, data: { error: 'Run not cancellable', code: 'RUN_NOT_CANCELLABLE' } },
      message: 'Request failed with status code 409',
    });

    await expect(WorkflowRunService.cancelRun('run-1')).rejects.toMatchObject({
      name: 'RunCommandError',
      status: 409,
      code: 'RUN_NOT_CANCELLABLE',
    });
  });

  it('newIdempotencyKey produit un uuid v4', () => {
    const { newIdempotencyKey } = require('../../services/workflowRunService');
    expect(newIdempotencyKey()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});

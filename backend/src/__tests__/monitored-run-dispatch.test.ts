import { logger } from '../services/logger';
import { MonitoredRunDispatch, type LeasedRunExecutor, type QueuedRunReconstructor } from '../services/runtime/MonitoredRunDispatch';
import type { RunLease, RunLeaseObservation } from '../services/runtime/MongoRunLeaseService';
import type { RunLeaseObserver } from '../services/runtime/RunLeaseMonitor';
import type { ExecutionOrchestratorRequest } from '../services/runtime/ExecutionOrchestrator';

describe('MonitoredRunDispatch', () => {
  const lease: RunLease = { executionId: 'run-1', owner: 'worker', token: 'token', expiresAt: new Date() };
  const request: ExecutionOrchestratorRequest = {
    fn: { _id: 'tool', name: 'tool', language: 'typescript', origin: 'custom' },
    userId: 'user',
    args: {},
    launchContext: 'editor_test',
    persistedExecutionId: lease.executionId,
    executeExistingQueued: true,
  };
  const timing = { intervalMs: 10, timeoutMs: 100, leaseDurationMs: 1000 };

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('renews before reconstruction and passes its monitor signal to the executor', async () => {
    const observer: RunLeaseObserver = { renewAndObserve: jest.fn().mockResolvedValue({ kind: 'active', lease }) };
    const prepare = jest.fn();
    const reconstructor: QueuedRunReconstructor = {
      reconstructQueuedRun: jest.fn().mockResolvedValue({ request, prepareForDispatch: prepare }),
    };
    const result = {
      success: true,
      output: 1,
      durationMs: 1,
      exitCode: 0,
      runner: 'docker_sandbox' as const,
      executionId: lease.executionId,
    };
    const executor: LeasedRunExecutor = { execute: jest.fn().mockResolvedValue(result) };
    const dispatch = new MonitoredRunDispatch(observer, reconstructor, executor, timing);

    await expect(dispatch.dispatch(lease)).resolves.toEqual(result);
    expect(observer.renewAndObserve).toHaveBeenCalledTimes(1);
    expect(reconstructor.reconstructQueuedRun).toHaveBeenCalledWith(lease);
    expect(executor.execute).toHaveBeenCalledWith(expect.objectContaining({ lease, leaseSignal: expect.any(AbortSignal) }), prepare);
    await jest.advanceTimersByTimeAsync(100);
    expect(observer.renewAndObserve).toHaveBeenCalledTimes(1);
  });

  it.each(['lost', 'cancellation_requested'] as const)('does not reconstruct after initial %s', async (kind) => {
    const observation: RunLeaseObservation = kind === 'lost' ? { kind } : { kind, lease };
    const observer: RunLeaseObserver = { renewAndObserve: jest.fn().mockResolvedValue(observation) };
    const reconstructor: QueuedRunReconstructor = { reconstructQueuedRun: jest.fn() };
    const executor: LeasedRunExecutor = { execute: jest.fn() };
    await expect(new MonitoredRunDispatch(observer, reconstructor, executor, timing).dispatch(lease)).rejects.toThrow(
      'Leased dispatch interrupted',
    );
    expect(reconstructor.reconstructQueuedRun).not.toHaveBeenCalled();
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('does not reconstruct if the initial renewal times out', async () => {
    jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    const observer: RunLeaseObserver = { renewAndObserve: jest.fn().mockReturnValue(new Promise(() => undefined)) };
    const reconstructor: QueuedRunReconstructor = { reconstructQueuedRun: jest.fn() };
    const executor: LeasedRunExecutor = { execute: jest.fn() };
    const work = new MonitoredRunDispatch(observer, reconstructor, executor, timing).dispatch(lease);
    const rejection = expect(work).rejects.toThrow('observation_failed');
    await jest.advanceTimersByTimeAsync(100);
    await rejection;
    expect(reconstructor.reconstructQueuedRun).not.toHaveBeenCalled();
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('does not execute after lease loss while reconstruction is pending', async () => {
    let finishReconstruction!: (value: Awaited<ReturnType<QueuedRunReconstructor['reconstructQueuedRun']>>) => void;
    const pending = new Promise<Awaited<ReturnType<QueuedRunReconstructor['reconstructQueuedRun']>>>((resolve) => {
      finishReconstruction = resolve;
    });
    const observer: RunLeaseObserver = {
      renewAndObserve: jest.fn().mockResolvedValueOnce({ kind: 'active', lease }).mockResolvedValueOnce({ kind: 'lost' }),
    };
    const reconstructor: QueuedRunReconstructor = { reconstructQueuedRun: jest.fn().mockReturnValue(pending) };
    const executor: LeasedRunExecutor = { execute: jest.fn() };
    const work = new MonitoredRunDispatch(observer, reconstructor, executor, timing).dispatch(lease);
    await jest.advanceTimersByTimeAsync(10);
    finishReconstruction({ request, prepareForDispatch: jest.fn() });
    await expect(work).rejects.toThrow('lease_lost');
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('propagates cancellation to an active executor and stops monitoring after it settles', async () => {
    const observer: RunLeaseObserver = {
      renewAndObserve: jest
        .fn()
        .mockResolvedValueOnce({ kind: 'active', lease })
        .mockResolvedValueOnce({ kind: 'cancellation_requested', lease }),
    };
    const reconstructor: QueuedRunReconstructor = {
      reconstructQueuedRun: jest.fn().mockResolvedValue({ request, prepareForDispatch: jest.fn() }),
    };
    const executor: LeasedRunExecutor = {
      execute: jest
        .fn()
        .mockImplementation(
          ({ leaseSignal }: ExecutionOrchestratorRequest) =>
            new Promise((_resolve, reject) => leaseSignal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
        ),
    };
    const work = new MonitoredRunDispatch(observer, reconstructor, executor, timing).dispatch(lease);
    const rejection = expect(work).rejects.toThrow('aborted');
    await jest.advanceTimersByTimeAsync(10);
    await rejection;
    await jest.advanceTimersByTimeAsync(100);
    expect(observer.renewAndObserve).toHaveBeenCalledTimes(2);
  });

  it('stops monitoring and preserves reconstruction errors without releasing the lease', async () => {
    const observer: RunLeaseObserver = { renewAndObserve: jest.fn().mockResolvedValue({ kind: 'active', lease }) };
    const reconstructor: QueuedRunReconstructor = { reconstructQueuedRun: jest.fn().mockRejectedValue(new Error('invalid target')) };
    const executor: LeasedRunExecutor = { execute: jest.fn() };
    await expect(new MonitoredRunDispatch(observer, reconstructor, executor, timing).dispatch(lease)).rejects.toThrow('invalid target');
    await jest.advanceTimersByTimeAsync(100);
    expect(observer.renewAndObserve).toHaveBeenCalledTimes(1);
    expect(executor.execute).not.toHaveBeenCalled();
  });
});

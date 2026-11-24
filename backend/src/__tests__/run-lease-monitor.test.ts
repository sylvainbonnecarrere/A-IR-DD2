import { logger } from '../services/logger';
import { RunLeaseMonitor, type RunLeaseObserver } from '../services/runtime/RunLeaseMonitor';
import type { RunLease, RunLeaseObservation } from '../services/runtime/MongoRunLeaseService';

describe('RunLeaseMonitor', () => {
  const lease: RunLease = {
    executionId: 'run-1',
    owner: 'worker',
    token: 'token',
    expiresAt: new Date('2026-01-01T00:00:30.000Z'),
  };

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('checks immediately and renews without overlapping observations', async () => {
    let completeSecond!: (value: RunLeaseObservation) => void;
    const second = new Promise<RunLeaseObservation>((resolve) => {
      completeSecond = resolve;
    });
    const observer: RunLeaseObserver = {
      renewAndObserve: jest.fn().mockResolvedValueOnce({ kind: 'active', lease }).mockReturnValueOnce(second),
    };
    const monitor = new RunLeaseMonitor(observer, lease, 10, 100, 1000);
    await monitor.start();
    expect(observer.renewAndObserve).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(50);
    expect(observer.renewAndObserve).toHaveBeenCalledTimes(2);
    completeSecond({ kind: 'active', lease });
    await jest.advanceTimersByTimeAsync(0);
    await monitor.stop();
    expect(monitor.getState()).toBe('stopped');
    expect(monitor.signal.aborted).toBe(false);
  });

  it.each([
    ['lost', 'lease_lost'],
    ['cancellation_requested', 'cancellation_requested'],
  ] as const)('aborts on %s', async (kind, expectedState) => {
    const observer: RunLeaseObserver = {
      renewAndObserve: jest.fn().mockResolvedValue(kind === 'lost' ? { kind } : { kind, lease }),
    };
    const monitor = new RunLeaseMonitor(observer, lease, 10, 100, 1000);
    await monitor.start();
    expect(monitor.signal.aborted).toBe(true);
    expect(monitor.getState()).toBe(expectedState);
    await jest.advanceTimersByTimeAsync(100);
    expect(observer.renewAndObserve).toHaveBeenCalledTimes(1);
    await monitor.stop();
  });

  it('aborts and logs a database failure without logging its contents', async () => {
    const log = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    const observer: RunLeaseObserver = {
      renewAndObserve: jest.fn().mockRejectedValue(new Error('private database details')),
    };
    const monitor = new RunLeaseMonitor(observer, lease, 10, 100, 1000);
    await monitor.start();
    expect(monitor.signal.aborted).toBe(true);
    expect(monitor.getState()).toBe('observation_failed');
    expect(JSON.stringify(log.mock.calls)).not.toContain('private database details');
    expect(log).toHaveBeenCalledTimes(1);
    await monitor.stop();
  });

  it('aborts on an unresponsive database and ignores a late successful renewal', async () => {
    let complete!: (value: RunLeaseObservation) => void;
    const pending = new Promise<RunLeaseObservation>((resolve) => {
      complete = resolve;
    });
    const observer: RunLeaseObserver = { renewAndObserve: jest.fn().mockReturnValue(pending) };
    jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    const monitor = new RunLeaseMonitor(observer, lease, 10, 100, 1000);
    const starting = monitor.start();
    await jest.advanceTimersByTimeAsync(100);
    await starting;
    expect(monitor.signal.aborted).toBe(true);
    expect(monitor.getState()).toBe('observation_failed');
    complete({ kind: 'active', lease });
    await jest.advanceTimersByTimeAsync(100);
    expect(observer.renewAndObserve).toHaveBeenCalledTimes(1);
    expect(monitor.getState()).toBe('observation_failed');
    await monitor.stop();
  });

  it('does not reschedule an observation after stopping during a request', async () => {
    let complete!: (value: RunLeaseObservation) => void;
    const pending = new Promise<RunLeaseObservation>((resolve) => {
      complete = resolve;
    });
    const observer: RunLeaseObserver = { renewAndObserve: jest.fn().mockReturnValue(pending) };
    const monitor = new RunLeaseMonitor(observer, lease, 10, 100, 1000);
    const starting = monitor.start();
    const stopping = monitor.stop();
    complete({ kind: 'active', lease });
    await Promise.all([starting, stopping]);
    await jest.advanceTimersByTimeAsync(200);
    expect(observer.renewAndObserve).toHaveBeenCalledTimes(1);
    expect(monitor.getState()).toBe('stopped');
    await expect(monitor.start()).rejects.toThrow('only be started once');
  });

  it('rejects invalid scheduling settings', () => {
    const observer: RunLeaseObserver = { renewAndObserve: jest.fn() };
    expect(() => new RunLeaseMonitor(observer, lease, 0, 100, 1000)).toThrow(RangeError);
    expect(() => new RunLeaseMonitor(observer, lease, 10, Infinity, 1000)).toThrow(RangeError);
    expect(() => new RunLeaseMonitor(observer, lease, 500, 500, 1000)).toThrow(RangeError);
    expect(() => new RunLeaseMonitor(observer, lease, 1, 1, 999)).toThrow(RangeError);
  });
});

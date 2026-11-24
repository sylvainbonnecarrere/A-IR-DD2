import { logger } from '../logger';
import type { ExecutionOrchestratorRequest, RunPreparation } from './ExecutionOrchestrator';
import type { OrchestratedExecutionResult } from './execution.types';
import type { RunLease } from './MongoRunLeaseService';
import { RunLeaseMonitor, type RunLeaseObserver } from './RunLeaseMonitor';
import { MongoWorkspaceLockService, type WorkspaceLock } from './MongoWorkspaceLockService';
import { MongoRunLeaseService } from './MongoRunLeaseService';
import { RunReconstructionRejection } from './RunReconstructionRejection';
import type { RunReconstructionRejectionCode } from '../../domain/execution/runReconstructionQuarantine';
import { USER_TOOL_RUN_TERMINAL_STATUS_VALUES } from '../../domain/execution/userToolRun.contract';

export interface QuarantinedDispatch {
  kind: 'quarantined';
  executionId: string;
  code: RunReconstructionRejectionCode;
}

export interface DeferredDispatch {
  kind: 'deferred';
  executionId: string;
}

export interface QueuedRunQuarantine {
  quarantineQueued(lease: RunLease, code: RunReconstructionRejectionCode): Promise<boolean>;
  deferQueued(lease: RunLease): Promise<boolean>;
}

export interface QueuedRunReconstructor {
  reconstructQueuedRun(lease: RunLease): Promise<{
    request: ExecutionOrchestratorRequest;
    prepareForDispatch: RunPreparation;
  }>;
}

export interface LeasedRunExecutor {
  execute(request: ExecutionOrchestratorRequest, prepareForDispatch: RunPreparation): Promise<OrchestratedExecutionResult>;
}

export interface WorkspaceLockAcquirer {
  tryAcquire(ownerUserId: string, workflowId: string, owner: string): Promise<WorkspaceLock | null>;
  release(lock: WorkspaceLock): Promise<boolean>;
  getOwner?(ownerUserId: string, workflowId: string): Promise<string | null>;
}

export class MonitoredRunDispatch {
  constructor(
    private readonly observer: RunLeaseObserver,
    private readonly reconstructor: QueuedRunReconstructor,
    private readonly executor: LeasedRunExecutor,
    private readonly timing: { intervalMs: number; timeoutMs: number; leaseDurationMs: number },
    private readonly workspaceLocks: WorkspaceLockAcquirer = new MongoWorkspaceLockService(),
    private readonly quarantine: QueuedRunQuarantine = new MongoRunLeaseService(timing.leaseDurationMs),
  ) {}

  async dispatch(lease: RunLease): Promise<OrchestratedExecutionResult | QuarantinedDispatch | DeferredDispatch> {
    const monitor = new RunLeaseMonitor(this.observer, lease, this.timing.intervalMs, this.timing.timeoutMs, this.timing.leaseDurationMs);
    try {
      await monitor.start();
      this.assertActive(monitor);
      let reconstructed: Awaited<ReturnType<QueuedRunReconstructor['reconstructQueuedRun']>>;
      try {
        reconstructed = await this.reconstructor.reconstructQueuedRun(lease);
      } catch (error) {
        if (!(error instanceof RunReconstructionRejection)) throw error;
        this.assertActive(monitor);
        if (!(await this.quarantine.quarantineQueued(lease, error.code))) {
          throw new Error('Queued run quarantine could not be confirmed');
        }
        logger.warn('[MonitoredRunDispatch] Queued run quarantined', { executionId: lease.executionId, code: error.code });
        return { kind: 'quarantined', executionId: lease.executionId, code: error.code };
      }
      const { request, prepareForDispatch } = reconstructed;
      this.assertActive(monitor);
      let workspaceLock: WorkspaceLock | undefined;
      if (request.fn.workflowId) {
        const lock = await this.workspaceLocks.tryAcquire(request.userId, request.fn.workflowId.toString(), lease.executionId);
        if (!lock) {
          const lockOwner = await this.workspaceLocks.getOwner?.(request.userId, request.fn.workflowId.toString());
          this.assertActive(monitor);
          if (!(await this.quarantine.deferQueued(lease))) {
            throw new Error('Queued run deferral could not be confirmed after workspace lock contention');
          }
          logger.info('[MonitoredRunDispatch] Queued run deferred while its workspace is locked', {
            executionId: lease.executionId,
            lockOwner,
          });
          return { kind: 'deferred', executionId: lease.executionId };
        }
        if (monitor.signal.aborted || monitor.getState() !== 'active') {
          if (!(await this.workspaceLocks.release(lock))) {
            throw new Error('Workspace lock could not be released after interrupted acquisition');
          }
          this.assertActive(monitor);
        }
        workspaceLock = lock;
        this.assertActive(monitor);
      }
      const result = await this.executor.execute(
        {
          ...request,
          lease,
          leaseSignal: monitor.signal,
          workspaceLock,
        },
        prepareForDispatch,
      );
      if (
        workspaceLock &&
        (USER_TOOL_RUN_TERMINAL_STATUS_VALUES as readonly string[]).includes(result.status ?? '') &&
        result.metadata?.runnerTerminationConfirmed === true
      ) {
        if (!(await this.workspaceLocks.release(workspaceLock))) {
          throw new Error(`Workspace lock release was not confirmed after terminal run ${lease.executionId}`);
        }
        workspaceLock = undefined;
      }
      if (workspaceLock) {
        logger.warn('[MonitoredRunDispatch] Workspace lock retained pending reconciliation', {
          executionId: lease.executionId,
        });
      }
      return result;
    } finally {
      await monitor.stop();
    }
  }

  private assertActive(monitor: RunLeaseMonitor): void {
    if (monitor.signal.aborted || monitor.getState() !== 'active') {
      throw new Error(`Leased dispatch interrupted: ${monitor.getState()}`);
    }
  }
}

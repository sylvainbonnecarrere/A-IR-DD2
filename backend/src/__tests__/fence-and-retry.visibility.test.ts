import { FenceAndRetryService } from '../services/fenceAndRetry.service';
import type {
    FenceAuditPort,
    FenceControlPort,
    FencedOperationLookupPort,
    QuarantinedRetryPort,
    QuarantinedRunStorePort,
    RunCommandIdempotencyPort,
    RuntimeAlertPort,
    WorkflowOwnershipPort,
} from '../services/runtime/fenceAndRetry.ports';
import type { RunVisibilityPort } from '../services/runtime/runVisibility.service';
import type { RunWorkspaceLockRecovery } from '../services/runtime/MongoExpiredRunReconciler';

const OPERATION_ID = '123e4567-e89b-42d3-a456-426614174000';
const ATTEMPT_ID = '123e4567-e89b-42d3-a456-426614174001';
const CONTAINER_NAME = `airdd2-j7-attempt-${ATTEMPT_ID}`;
const WORKSPACE = '507f1f77bcf86cd799439011';
const USER = '507f1f77bcf86cd799439099';
const AGENT = '507f1f77bcf86cd799439012';

function fencedOperation() {
    return {
        id: OPERATION_ID,
        epoch: 3,
        effect: { command: 'run' as const, containerName: CONTAINER_NAME, attemptId: ATTEMPT_ID },
        fencedAt: new Date(),
        fenceKind: 'auto_epoch_rotation' as const,
        nameReservation: { containerName: CONTAINER_NAME, reserved: true },
        quiescenceProven: false,
    };
}

function createPorts(options: { quiescent?: boolean } = {}) {
    const quiescent = options.quiescent ?? true;
    const control: jest.Mocked<FenceControlPort> = {
        fenceOperation: jest.fn().mockResolvedValue({ fenced: true, nameReserved: true, quiescent, observed: [] }),
        verifyFenced: jest.fn().mockResolvedValue({ quiescent }),
    };
    const lookup: jest.Mocked<FencedOperationLookupPort> = {
        getFencedOperations: jest.fn().mockResolvedValue([fencedOperation()]),
    };
    const runs: jest.Mocked<QuarantinedRunStorePort> = {
        findOwnedRunInWorkspace: jest.fn().mockResolvedValue({
            executionId: 'run-quar-1',
            ownerUserId: USER,
            workflowId: WORKSPACE,
            status: 'quarantined',
            error: { code: 'QUARANTINED', retryable: true },
            recoveryAttemptCount: 0,
            supervisedAttempt: { attemptId: ATTEMPT_ID },
            agentInstanceId: AGENT,
        }),
    };
    const workflows: jest.Mocked<WorkflowOwnershipPort> = {
        existsOwnedWorkflow: jest.fn().mockResolvedValue(true),
    };
    const locks: jest.Mocked<RunWorkspaceLockRecovery> = {
        releaseForRun: jest.fn().mockResolvedValue('released'),
    };
    const audit: jest.Mocked<FenceAuditPort> = { record: jest.fn().mockResolvedValue(undefined) };
    const alerts: jest.Mocked<RuntimeAlertPort> = { raise: jest.fn().mockResolvedValue(undefined) };
    const idempotency: jest.Mocked<RunCommandIdempotencyPort> = {
        find: jest.fn().mockResolvedValue(null),
        store: jest.fn().mockResolvedValue(undefined),
    };
    const retry: jest.Mocked<QuarantinedRetryPort> = {
        retryQuarantinedRun: jest.fn().mockResolvedValue({ executionId: 'run-child-1', status: 'queued', replayed: false }),
    };
    const visibility: jest.Mocked<RunVisibilityPort> = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new FenceAndRetryService(
        control, lookup, runs, workflows, locks, audit, alerts, idempotency, retry, visibility,
    );
    return { service, control, lookup, runs, workflows, locks, audit, alerts, idempotency, retry, visibility };
}

describe('FenceAndRetryService visibility (US-J7-09)', () => {

    it('records run_fenced then run_recovery_relaunched on a successful fence-and-retry', async () => {
        const { service, visibility } = createPorts();

        const result = await service.fenceAndRetry({
            userId: USER,
            workspaceId: WORKSPACE,
            runId: 'run-quar-1',
            idempotencyKey: 'key-1',
            reason: 'AGENT_AUTO_RECOVERY',
        });

        expect(result.kind).toBe('accepted');
        expect(visibility.record).toHaveBeenCalledTimes(2);

        expect(visibility.record).toHaveBeenNthCalledWith(1, expect.objectContaining({
            workspaceId: WORKSPACE,
            runId: 'run-quar-1',
            agentInstanceId: AGENT,
            event: 'run_fenced',
            cause: 'AGENT_AUTO_RECOVERY',
            lockHeld: true,
            fencedOperationId: OPERATION_ID,
        }));
        expect(visibility.record).toHaveBeenNthCalledWith(2, expect.objectContaining({
            workspaceId: WORKSPACE,
            runId: 'run-quar-1',
            agentInstanceId: AGENT,
            event: 'run_recovery_relaunched',
            cause: 'AGENT_AUTO_RECOVERY',
            lockHeld: false,
            fencedOperationId: OPERATION_ID,
            newRunId: 'run-child-1',
            recoveryAttemptCount: 1,
        }));
    });

    it('records no fenced/relaunched visibility when quiescence is unproven (504 fail-closed)', async () => {
        const { service, visibility, alerts } = createPorts({ quiescent: false });

        await expect(service.fenceAndRetry({
            userId: USER,
            workspaceId: WORKSPACE,
            runId: 'run-quar-1',
            idempotencyKey: 'key-2',
        })).rejects.toMatchObject({ statusCode: 504, code: 'FENCING_TIMEOUT_ESCALATED' });

        expect(visibility.record).not.toHaveBeenCalled();
        expect(alerts.raise).toHaveBeenCalledWith(expect.objectContaining({
            severity: 'critical',
            code: 'FENCING_TIMEOUT_ESCALATED',
            runId: 'run-quar-1',
        }));
    });

    it('works without a visibility port (backward compatible)', async () => {
        const ports = createPorts();
        const service = new FenceAndRetryService(
            ports.control, ports.lookup, ports.runs, ports.workflows, ports.locks,
            ports.audit, ports.alerts, ports.idempotency, ports.retry,
        );

        const result = await service.fenceAndRetry({
            userId: USER,
            workspaceId: WORKSPACE,
            runId: 'run-quar-1',
            idempotencyKey: 'key-3',
        });

        expect(result.kind).toBe('accepted');
        expect(ports.visibility.record).not.toHaveBeenCalled();
    });
});

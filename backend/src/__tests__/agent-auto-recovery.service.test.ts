import { AgentAutoRecoveryService, type QuarantinedRunEntry } from '../services/runtime/agentAutoRecovery.service';
import type { FenceAndRetryService } from '../services/fenceAndRetry.service';
import { AgentInstance } from '../models/AgentInstance.model';
import { AgentPrototype } from '../models/AgentPrototype.model';

jest.mock('../models/AgentInstance.model', () => ({
    AgentInstance: { findById: jest.fn() },
}));

jest.mock('../models/AgentPrototype.model', () => ({
    AgentPrototype: { findById: jest.fn() },
}));

const mockInstanceFindById = AgentInstance.findById as jest.Mock;
const mockPrototypeFindById = AgentPrototype.findById as jest.Mock;

function selectLean(value: unknown) {
    return {
        select: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue(value),
        }),
    };
}

function createFenceAndRetryMock() {
    return { fenceAndRetry: jest.fn().mockResolvedValue({ kind: 'accepted', replayed: false, response: {} }) };
}

function createRun(overrides: Partial<QuarantinedRunEntry> = {}): QuarantinedRunEntry {
    return {
        executionId: 'run-1',
        ownerUserId: 'user-1',
        workflowId: '507f1f77bcf86cd799439011',
        attemptId: '123e4567-e89b-42d3-a456-426614174000',
        recoveryAttemptCount: 0,
        agentInstanceId: '507f1f77bcf86cd799439012',
        agentPrototypeId: '507f1f77bcf86cd799439013',
        ...overrides,
    };
}

const ENABLED_ENV = { AGENT_AUTO_RECOVERY: 'true' };

describe('AgentAutoRecoveryService (US-J7-08)', () => {

    beforeEach(() => {
        jest.clearAllMocks();
        mockInstanceFindById.mockReturnValue(selectLean(null));
        mockPrototypeFindById.mockReturnValue(selectLean(null));
    });

    it('is disabled when AGENT_AUTO_RECOVERY is not "true" and never calls fence-and-retry', async () => {
        const fenceAndRetry = createFenceAndRetryMock();
        const service = new AgentAutoRecoveryService(fenceAndRetry as unknown as FenceAndRetryService, {});

        const outcome = await service.tryRecoverQuarantinedRun(createRun());

        expect(outcome).toBe('disabled');
        expect(fenceAndRetry.fenceAndRetry).not.toHaveBeenCalled();
    });

    it('returns no_workspace when the run has no workflowId', async () => {
        const fenceAndRetry = createFenceAndRetryMock();
        const service = new AgentAutoRecoveryService(fenceAndRetry as unknown as FenceAndRetryService, ENABLED_ENV);

        const outcome = await service.tryRecoverQuarantinedRun(createRun({ workflowId: null }));

        expect(outcome).toBe('no_workspace');
        expect(fenceAndRetry.fenceAndRetry).not.toHaveBeenCalled();
    });

    it('stays policy_off when the instance policy is the default off', async () => {
        const fenceAndRetry = createFenceAndRetryMock();
        const service = new AgentAutoRecoveryService(fenceAndRetry as unknown as FenceAndRetryService, ENABLED_ENV);
        mockInstanceFindById.mockReturnValue(selectLean({ recoveryPolicy: { autoFenceAndRetry: false, maxAttempts: 0 } }));

        const outcome = await service.tryRecoverQuarantinedRun(createRun());

        expect(outcome).toBe('policy_off');
        expect(fenceAndRetry.fenceAndRetry).not.toHaveBeenCalled();
    });

    it('falls back to the prototype policy when the instance has none', async () => {
        const fenceAndRetry = createFenceAndRetryMock();
        const service = new AgentAutoRecoveryService(fenceAndRetry as unknown as FenceAndRetryService, ENABLED_ENV);
        mockInstanceFindById.mockReturnValue(selectLean({}));
        mockPrototypeFindById.mockReturnValue(selectLean({ recoveryPolicy: { autoFenceAndRetry: true, maxAttempts: 3 } }));

        const outcome = await service.tryRecoverQuarantinedRun(createRun());

        expect(outcome).toBe('recovered');
        expect(fenceAndRetry.fenceAndRetry).toHaveBeenCalledWith({
            userId: 'user-1',
            workspaceId: '507f1f77bcf86cd799439011',
            runId: 'run-1',
            idempotencyKey: 'auto-recovery:run-1:0',
            reason: 'AGENT_AUTO_RECOVERY',
        });
    });

    it('uses the instance snapshot policy and builds the per-attempt idempotency key', async () => {
        const fenceAndRetry = createFenceAndRetryMock();
        const service = new AgentAutoRecoveryService(fenceAndRetry as unknown as FenceAndRetryService, ENABLED_ENV);
        mockInstanceFindById.mockReturnValue(selectLean({ recoveryPolicy: { autoFenceAndRetry: true, maxAttempts: 2 } }));

        const outcome = await service.tryRecoverQuarantinedRun(createRun({ recoveryAttemptCount: 1 }));

        expect(outcome).toBe('recovered');
        expect(fenceAndRetry.fenceAndRetry).toHaveBeenCalledWith(expect.objectContaining({
            idempotencyKey: 'auto-recovery:run-1:1',
            reason: 'AGENT_AUTO_RECOVERY',
        }));
    });

    it('stops at the threshold: recoveryAttemptCount >= maxAttempts is not retried', async () => {
        const fenceAndRetry = createFenceAndRetryMock();
        const service = new AgentAutoRecoveryService(fenceAndRetry as unknown as FenceAndRetryService, ENABLED_ENV);
        mockInstanceFindById.mockReturnValue(selectLean({ recoveryPolicy: { autoFenceAndRetry: true, maxAttempts: 2 } }));

        const outcome = await service.tryRecoverQuarantinedRun(createRun({ recoveryAttemptCount: 2 }));

        expect(outcome).toBe('threshold_reached');
        expect(fenceAndRetry.fenceAndRetry).not.toHaveBeenCalled();
    });

    it('fails closed (run stays quarantined) when fence-and-retry throws', async () => {
        const fenceAndRetry = createFenceAndRetryMock();
        fenceAndRetry.fenceAndRetry.mockRejectedValue(new Error('FENCING_TIMEOUT_ESCALATED'));
        const service = new AgentAutoRecoveryService(fenceAndRetry as unknown as FenceAndRetryService, ENABLED_ENV);
        mockInstanceFindById.mockReturnValue(selectLean({ recoveryPolicy: { autoFenceAndRetry: true, maxAttempts: 5 } }));
        const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);

        try {
            const outcome = await service.tryRecoverQuarantinedRun(createRun());

            expect(outcome).toBe('failed');
            expect(fenceAndRetry.fenceAndRetry).toHaveBeenCalledTimes(1);
            expect(log).toHaveBeenCalled();
        } finally {
            log.mockRestore();
        }
    });

    it('defaults to policy off when policy resolution errors', async () => {
        const fenceAndRetry = createFenceAndRetryMock();
        const service = new AgentAutoRecoveryService(fenceAndRetry as unknown as FenceAndRetryService, ENABLED_ENV);
        mockInstanceFindById.mockImplementation(() => {
            throw new Error('mongo down');
        });
        const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);

        try {
            const outcome = await service.tryRecoverQuarantinedRun(createRun());

            expect(outcome).toBe('policy_off');
            expect(fenceAndRetry.fenceAndRetry).not.toHaveBeenCalled();
        } finally {
            log.mockRestore();
        }
    });
});

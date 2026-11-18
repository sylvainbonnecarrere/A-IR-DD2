import { MongoRunVisibilityService, type RunVisibilityEntry } from '../services/runtime/runVisibility.service';
import { RuntimeEventPublisher } from '../services/runtimeEventPublisher.service';
import { AgentJournal } from '../models/AgentJournal.model';

jest.mock('../models/AgentJournal.model', () => ({
    AgentJournal: { create: jest.fn() },
}));

const mockJournalCreate = AgentJournal.create as jest.Mock;

const WORKSPACE = '507f1f77bcf86cd799439011';
const AGENT = '507f1f77bcf86cd799439012';

function createEntry(overrides: Partial<RunVisibilityEntry> = {}): RunVisibilityEntry {
    return {
        workspaceId: WORKSPACE,
        runId: 'run-quar-1',
        agentInstanceId: AGENT,
        event: 'run_quarantined',
        cause: 'QUARANTINED',
        lockHeld: true,
        fencedOperationId: 'op-123',
        message: 'Preuve de quiescence absente',
        ...overrides,
    };
}

function createHarness() {
    const emitted: Array<{ workspaceId: string; event: any }> = [];
    const publisher = new RuntimeEventPublisher({
        emitRuntimeEvent: (workspaceId: string, event: unknown) => {
            emitted.push({ workspaceId, event: event as any });
            return true;
        },
    });
    const service = new MongoRunVisibilityService(publisher, { create: mockJournalCreate } as any);
    return { service, emitted };
}

describe('MongoRunVisibilityService (US-J7-09)', () => {

    beforeEach(() => {
        jest.clearAllMocks();
        mockJournalCreate.mockResolvedValue({ _id: 'journal-1' });
    });

    it('records a run_quarantined journal entry and emits run:quarantined with lockHeld', async () => {
        const { service, emitted } = createHarness();

        await service.record(createEntry());

        expect(emitted).toHaveLength(1);
        expect(emitted[0].workspaceId).toBe(WORKSPACE);
        expect(emitted[0].event.type).toBe('run:quarantined');
        expect(emitted[0].event.payload).toEqual(expect.objectContaining({
            status: 'quarantined',
            lockHeld: true,
            errorCode: 'QUARANTINED',
            operationId: 'op-123',
            runId: 'run-quar-1',
            agentId: AGENT,
        }));
        expect(emitted[0].event.payload.userId).toBeUndefined();

        expect(mockJournalCreate).toHaveBeenCalledTimes(1);
        const journalArg = mockJournalCreate.mock.calls[0][0];
        expect(journalArg.type).toBe('system');
        expect(journalArg.severity).toBe('error');
        expect(journalArg.agentInstanceId.toString()).toBe(AGENT);
        expect(journalArg.workflowId.toString()).toBe(WORKSPACE);
        expect(journalArg.payload.event).toBe('run_quarantined');
        expect(journalArg.payload.triggeredBy).toBe('system');
        expect(journalArg.payload.details).toEqual({
            runId: 'run-quar-1',
            cause: 'QUARANTINED',
            lockHeld: true,
            fencedOperationId: 'op-123',
        });
        // Aucun secret dans le payload journal
        expect(JSON.stringify(journalArg.payload)).not.toMatch(/userId|token|password|secret/i);
    });

    it('records run_fenced (warn) and run_recovery_relaunched (info) with their event types', async () => {
        const { service, emitted } = createHarness();

        await service.record(createEntry({
            event: 'run_fenced',
            cause: 'AGENT_AUTO_RECOVERY',
            lockHeld: true,
        }));
        await service.record(createEntry({
            event: 'run_recovery_relaunched',
            cause: 'AGENT_AUTO_RECOVERY',
            lockHeld: false,
            newRunId: 'run-child-1',
            recoveryAttemptCount: 1,
        }));

        expect(emitted.map((entry) => entry.event.type)).toEqual(['run:fenced', 'run:recovery_relaunched']);
        expect(mockJournalCreate.mock.calls[0][0].severity).toBe('warn');
        expect(mockJournalCreate.mock.calls[1][0].severity).toBe('info');
        expect(mockJournalCreate.mock.calls[1][0].payload.details).toEqual(expect.objectContaining({
            newRunId: 'run-child-1',
            recoveryAttemptCount: 1,
            lockHeld: false,
        }));
        expect(emitted[1].event.payload).toEqual(expect.objectContaining({
            newRunId: 'run-child-1',
            recoveryAttemptCount: 1,
        }));
    });

    it('still emits the runtime event when the run has no agentInstanceId (no journal entry)', async () => {
        const { service, emitted } = createHarness();

        await service.record(createEntry({ agentInstanceId: null }));

        expect(emitted).toHaveLength(1);
        expect(emitted[0].event.type).toBe('run:quarantined');
        expect(mockJournalCreate).not.toHaveBeenCalled();
    });

    it('never throws when the journal write fails (fail-safe)', async () => {
        mockJournalCreate.mockRejectedValue(new Error('mongo down'));
        const { service, emitted } = createHarness();
        const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);

        try {
            await expect(service.record(createEntry())).resolves.toBeUndefined();
            expect(emitted).toHaveLength(1);
            expect(log).toHaveBeenCalled();
        } finally {
            log.mockRestore();
        }
    });

    it('never throws when the event emission fails (fail-safe)', async () => {
        const failingPublisher = new RuntimeEventPublisher({
            emitRuntimeEvent: () => {
                throw new Error('ws down');
            },
        });
        const service = new MongoRunVisibilityService(failingPublisher, { create: mockJournalCreate } as any);
        const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);

        try {
            await expect(service.record(createEntry())).resolves.toBeUndefined();
            expect(mockJournalCreate).toHaveBeenCalledTimes(1);
        } finally {
            log.mockRestore();
        }
    });

    it('skips the journal when workspaceId is not a valid ObjectId', async () => {
        const { service, emitted } = createHarness();

        await service.record(createEntry({ workspaceId: 'not-an-objectid' }));

        // L'événement n'est pas émis non plus (workspace invalide rejeté par le contrat).
        expect(emitted).toHaveLength(0);
        expect(mockJournalCreate).not.toHaveBeenCalled();
    });
});

import mongoose from 'mongoose';
import { UserToolRun } from '../models/UserToolRun.model';
import { ExecutionOrchestrator, type ExecutionOrchestratorRequest } from '../services/runtime/ExecutionOrchestrator';
import { MongoRunLeaseService } from '../services/runtime/MongoRunLeaseService';
import { UserToolRunService } from '../services/userToolRun.service';

describe('durable run acknowledgements', () => {
    afterEach(() => jest.restoreAllMocks());

    it('does not dispatch locally after a lost creation response and replays the persisted run', async () => {
        const request: ExecutionOrchestratorRequest = {
            fn: {
                _id: new mongoose.Types.ObjectId(), name: 'fixture', language: 'typescript',
                origin: 'custom', codeInline: 'function run() { return 1; }',
            },
            userId: new mongoose.Types.ObjectId().toString(),
            args: {}, launchContext: 'editor_test', idempotencyKey: 'same-intent',
        };
        const orchestrator = new ExecutionOrchestrator();
        const execute = jest.spyOn(orchestrator, 'execute').mockImplementation(async (input) => ({
            executionId: input.persistedExecutionId!, status: 'completed', success: true,
            output: 1, durationMs: 1, exitCode: 0, runner: 'docker_sandbox',
        }));
        const original = UserToolRunService.prototype.createQueuedRun;
        const create = jest.spyOn(UserToolRunService.prototype, 'createQueuedRun')
            .mockImplementationOnce(async function (this: UserToolRunService, data) {
                await original.call(this, data);
                throw new Error('simulated lost creation response');
            });
        await expect(orchestrator.enqueue(request)).rejects.toThrow('simulated lost creation response');
        expect(execute).not.toHaveBeenCalled();
        expect(await UserToolRun.countDocuments({})).toBe(1);

        const replay = await orchestrator.enqueue(request);
        expect(replay).toMatchObject({ status: 'queued', replayed: true });
        const lease = await new MongoRunLeaseService(30_000).claimQueued('ack-worker');
        expect(lease?.executionId).toBe(replay.executionId);
        expect(execute).not.toHaveBeenCalled();
        expect(create).toHaveBeenCalledTimes(1);
        expect(await UserToolRun.countDocuments({})).toBe(1);
    });

    it.each(['queued', 'running'] as const)(
        'preserves a committed cancellation after a simulated lost response for %s',
        async (status) => {
            const runs = new UserToolRunService();
            const owner = new mongoose.Types.ObjectId();
            const executionId = `lost-cancel-${status}`;
            await runs.createQueuedRun({
                executionId, ownerUserId: owner, toolId: new mongoose.Types.ObjectId(),
                toolVersionTag: 'v1', toolContentHash: 'hash', launchContext: 'editor_test',
                runtime: 'typescript', policySnapshot: { networkMode: 'none' },
            });
            if (status === 'running') await runs.markRunning(executionId);
            const original = runs.requestCancellation.bind(runs);
            const lostResponse = async () => {
                await original(executionId, owner);
                throw new Error('simulated lost cancellation response');
            };
            await expect(lostResponse()).rejects.toThrow('simulated lost cancellation response');
            const replay = await original(executionId, owner);
            expect(replay.kind).toBe(status === 'queued' ? 'stopped' : 'requested');
            expect((await runs.getRunByExecutionId(executionId, 'majority'))?.cancellationRequestedAt).toBeTruthy();
        },
    );
});

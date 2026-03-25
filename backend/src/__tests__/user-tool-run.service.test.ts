import mongoose from 'mongoose';
import { UserToolRun } from '../models/UserToolRun.model';
import { UserToolRunService, UserToolRunStateError } from '../services/userToolRun.service';

describe('UserToolRunService', () => {
    const service = new UserToolRunService();

    afterEach(async () => {
        await UserToolRun.deleteMany({});
    });

    function buildCreateData() {
        return {
            executionId: `run-${new mongoose.Types.ObjectId().toString()}`,
            ownerUserId: new mongoose.Types.ObjectId(),
            toolId: new mongoose.Types.ObjectId(),
            toolVersionTag: 'v1',
            toolContentHash: 'hash-v1',
            workflowId: new mongoose.Types.ObjectId(),
            agentPrototypeId: new mongoose.Types.ObjectId(),
            agentInstanceId: new mongoose.Types.ObjectId(),
            launchContext: 'workflow_run' as const,
            runtime: 'python' as const,
            runner: 'docker_rootless' as const,
            inputs: {
                prompt: 'run test'
            },
            policySnapshot: {
                networkMode: 'restricted' as const,
                timeoutSeconds: 60,
                maxMemoryMb: 256,
                secretAliases: []
            }
        };
    }

    it('creates, starts and completes a run with the expected timing metadata', async () => {
        const createData = buildCreateData();
        const queuedAt = new Date('2026-03-17T11:00:00.000Z');
        const startedAt = new Date('2026-03-17T11:00:05.000Z');
        const finishedAt = new Date('2026-03-17T11:00:17.000Z');

        const queuedRun = await service.createQueuedRun({
            ...createData,
            queuedAt
        });

        expect(queuedRun.status).toBe('queued');
        expect(queuedRun.timing.queuedAt?.toISOString()).toBe(queuedAt.toISOString());
        expect(queuedRun.timing.startedAt).toBeNull();
        expect(queuedRun.timing.finishedAt).toBeNull();

        const runningRun = await service.markRunning(createData.executionId, startedAt);

        expect(runningRun.status).toBe('running');
        expect(runningRun.timing.startedAt?.toISOString()).toBe(startedAt.toISOString());
        expect(runningRun.error).toBeNull();

        const completedRun = await service.completeRun(createData.executionId, {
            outputs: {
                stdout: 'done',
                result: { ok: true }
            },
            resourceUsage: {
                peakMemoryMb: 128,
                cpuMs: 240
            },
            finishedAt
        });

        expect(completedRun.status).toBe('completed');
        expect(completedRun.outputs).toEqual(expect.objectContaining({
            stdout: 'done',
            result: expect.objectContaining({ ok: true })
        }));
        expect(completedRun.resourceUsage).toEqual(expect.objectContaining({
            peakMemoryMb: 128,
            cpuMs: 240
        }));
        expect(completedRun.timing.finishedAt?.toISOString()).toBe(finishedAt.toISOString());
        expect(completedRun.timing.durationMs).toBe(12000);

        const persisted = await service.getRunByExecutionId(createData.executionId);
        expect(persisted?.status).toBe('completed');
    });

    it('allows failing directly from queued state', async () => {
        const createData = buildCreateData();

        await service.createQueuedRun(createData);
        const failedRun = await service.failRun(createData.executionId, {
            error: {
                code: 'TOOL_CRASH',
                message: 'Tool execution crashed',
                retryable: true
            },
            outputs: {
                stderr: 'segmentation fault'
            },
            finishedAt: new Date('2026-03-17T12:00:30.000Z')
        });

        expect(failedRun.status).toBe('failed');
        expect(failedRun.error).toEqual(expect.objectContaining({
            code: 'TOOL_CRASH',
            message: 'Tool execution crashed',
            retryable: true
        }));
        expect(failedRun.outputs).toEqual(expect.objectContaining({
            stderr: 'segmentation fault'
        }));
    });

    it('rejects invalid transitions from terminal states', async () => {
        const createData = buildCreateData();

        await service.createQueuedRun(createData);
        await service.markRunning(createData.executionId, new Date('2026-03-17T13:00:00.000Z'));
        await service.completeRun(createData.executionId, {
            finishedAt: new Date('2026-03-17T13:00:10.000Z')
        });

        await expect(
            service.markRunning(createData.executionId, new Date('2026-03-17T13:00:20.000Z'))
        ).rejects.toBeInstanceOf(UserToolRunStateError);

        await expect(
            service.failRun(createData.executionId, {
                error: {
                    message: 'should not happen'
                }
            })
        ).rejects.toBeInstanceOf(UserToolRunStateError);
    });

    it('persists burst queued runs independently for the same user and tool', async () => {
        const baseData = buildCreateData();
        const burstRuns = Array.from({ length: 10 }, (_, index) => ({
            ...baseData,
            executionId: `run-burst-${index}-${new mongoose.Types.ObjectId().toString()}`,
            inputs: { prompt: `run ${index}` }
        }));

        await Promise.all(burstRuns.map((runData) => service.createQueuedRun(runData)));

        const persistedRuns = await service.listRuns({
            ownerUserId: baseData.ownerUserId,
            toolId: baseData.toolId,
            statuses: ['queued'],
            limit: 20
        });

        expect(persistedRuns).toHaveLength(10);
        expect(persistedRuns.map((run) => run.executionId).sort()).toEqual(burstRuns.map((run) => run.executionId).sort());
    });

    it('allows only one terminal transition to win under concurrent updates on the same run', async () => {
        const createData = buildCreateData();

        await service.createQueuedRun(createData);
        await service.markRunning(createData.executionId, new Date('2026-03-17T14:00:00.000Z'));

        const [completionAttempt, failureAttempt] = await Promise.allSettled([
            service.completeRun(createData.executionId, {
                outputs: { stdout: 'done', result: { ok: true } },
                finishedAt: new Date('2026-03-17T14:00:05.000Z')
            }),
            service.failRun(createData.executionId, {
                error: {
                    code: 'RACE_FAIL',
                    message: 'Concurrent failure should lose once completion wins',
                    retryable: false
                },
                finishedAt: new Date('2026-03-17T14:00:06.000Z')
            })
        ]);

        const fulfilled = [completionAttempt, failureAttempt].filter((result) => result.status === 'fulfilled');
        const rejected = [completionAttempt, failureAttempt].filter((result) => result.status === 'rejected');

        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(UserToolRunStateError);

        const persisted = await service.getRunByExecutionId(createData.executionId);
        expect(persisted?.status === 'completed' || persisted?.status === 'failed').toBe(true);

        if (persisted?.status === 'completed') {
            expect(persisted.outputs).toEqual(expect.objectContaining({ stdout: 'done' }));
        }

        if (persisted?.status === 'failed') {
            expect(persisted.error).toEqual(expect.objectContaining({ code: 'RACE_FAIL' }));
        }
    });
});
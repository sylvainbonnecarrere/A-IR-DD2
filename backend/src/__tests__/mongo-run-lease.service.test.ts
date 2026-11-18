import mongoose from 'mongoose';
import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';
import { UserToolRun } from '../models/UserToolRun.model';
import { MongoRunLeaseService } from '../services/runtime/MongoRunLeaseService';
import { UserToolRunService, UserToolRunStateError } from '../services/userToolRun.service';

describe('MongoRunLeaseService', () => {
    const runs = new UserToolRunService();
    const leases = new MongoRunLeaseService(30_000);

    async function queued(executionId = 'lease-test-run') {
        await runs.createQueuedRun({
            executionId,
            ownerUserId: new mongoose.Types.ObjectId(),
            toolId: new mongoose.Types.ObjectId(),
            toolVersionTag: 'v1',
            toolContentHash: 'hash',
            launchContext: 'editor_test',
            runtime: 'typescript',
            policySnapshot: { networkMode: 'none' },
        });
    }

    it('atomically grants one claim and fences legacy and incorrect owners', async () => {
        await queued();
        const claims = await Promise.all(Array.from({ length: 10 }, (_, i) => leases.claimQueued(`worker-${i}`)));
        const granted = claims.filter((claim) => claim !== null);
        expect(granted).toHaveLength(1);
        const lease = granted[0]!;
        expect((await UserToolRun.findOne({ executionId: lease.executionId }).lean())?.lease?.token).toBeUndefined();
        await expect(runs.markRunning(lease.executionId)).rejects.toBeInstanceOf(UserToolRunStateError);
        await expect(runs.markRunning(lease.executionId, new Date(), undefined, { ...lease, token: 'wrong' }))
            .rejects.toBeInstanceOf(UserToolRunStateError);
        await expect(runs.markRunning(lease.executionId, new Date(), undefined, lease))
            .resolves.toMatchObject({ status: 'running' });
        await expect(runs.completeRun(lease.executionId)).rejects.toBeInstanceOf(UserToolRunStateError);
        await expect(runs.completeRun(lease.executionId, {}, lease)).resolves.toMatchObject({ status: 'completed', lease: null });
    });

    it('requires majority acknowledgement for lease writes and fenced transitions', async () => {
        await queued();
        const findAndUpdate = jest.spyOn(UserToolRun, 'findOneAndUpdate');
        const update = jest.spyOn(UserToolRun, 'updateOne');
        try {
            const lease = (await leases.claimQueued('worker'))!;
            await leases.renew(lease);
            await leases.releaseQueued(lease);
            const next = (await leases.claimQueued('worker'))!;
            await runs.markRunning(next.executionId, new Date(), undefined, next);
            await runs.completeRun(next.executionId, {}, next);
            expect(findAndUpdate).toHaveBeenCalledTimes(5);
            for (const call of findAndUpdate.mock.calls) {
                expect(call[2]).toEqual(expect.objectContaining({
                    writeConcern: { w: 'majority', wtimeoutMS: 10_000 },
                }));
            }
            expect(update).toHaveBeenCalledWith(
                expect.any(Object), expect.any(Object),
                expect.objectContaining({ writeConcern: { w: 'majority', wtimeoutMS: 10_000 } }),
            );
        } finally {
            findAndUpdate.mockRestore();
            update.mockRestore();
        }
    });

    it('allows only one of two independent worker processes to claim a persisted run', async () => {
        await queued();
        const execFileAsync = promisify(execFile);
        const fixture = path.join(__dirname, 'fixtures', 'lease-claim-worker.ts');
        const results = await Promise.all(['process-a', 'process-b'].map((owner) =>
            execFileAsync(process.execPath, ['--import', 'tsx', fixture, owner], {
                env: process.env,
                timeout: 20_000,
            }),
        ));
        expect(results.map(({ stdout }) => JSON.parse(stdout).claimed).sort()).toEqual([false, true]);
        expect((await runs.getRunByExecutionId('lease-test-run'))?.status).toBe('queued');
    });

    it('reclaims expired queued leases but fences the previous owner', async () => {
        await queued();
        const old = (await leases.claimQueued('old-worker'))!;
        await UserToolRun.updateOne({ executionId: old.executionId }, { $set: { 'lease.expiresAt': new Date(0) } });
        expect(await leases.renew(old)).toBeNull();
        expect(await leases.releaseQueued(old)).toBe(false);
        const current = (await leases.claimQueued('new-worker'))!;
        expect(current.token).not.toBe(old.token);
        await expect(runs.markRunning(old.executionId, new Date(), undefined, old)).rejects.toBeInstanceOf(UserToolRunStateError);
        await expect(runs.markRunning(current.executionId, new Date(), undefined, current)).resolves.toMatchObject({ status: 'running' });
    });

    it('atomically pins claimed runs for retention and keeps the pin on reclaim', async () => {
        const executionId = 'workspace-retention-lease';
        await runs.createQueuedRun({
            executionId,
            ownerUserId: new mongoose.Types.ObjectId(),
            toolId: new mongoose.Types.ObjectId(),
            workflowId: new mongoose.Types.ObjectId(),
            toolVersionTag: 'v1', toolContentHash: 'hash', launchContext: 'workflow_run',
            runtime: 'typescript', policySnapshot: { networkMode: 'none' },
        });
        const lease = (await leases.claimQueued('worker'))!;
        expect((await UserToolRun.findOne({ executionId }).select('+workspaceRetentionProtected').lean())?.workspaceRetentionProtected).toBe(true);
        await UserToolRun.updateOne({ executionId }, { $set: { workflowId: null, 'lease.expiresAt': new Date(0) } });
        expect((await leases.claimQueued('replacement'))?.executionId).toBe(executionId);
        expect((await UserToolRun.findOne({ executionId }).select('+workspaceRetentionProtected').lean())?.workspaceRetentionProtected).toBe(true);
        expect(lease.executionId).toBe(executionId);
    });

    it('also pins runs without a workflow because reconstruction may resolve a workspace', async () => {
        await queued('no-workspace');
        expect((await leases.claimQueued('worker'))?.executionId).toBe('no-workspace');
        expect((await UserToolRun.findOne({ executionId: 'no-workspace' }).select('+workspaceRetentionProtected').lean())?.workspaceRetentionProtected).toBe(true);
    });

    it('does not reclaim expired running leases or permit stale terminal writes', async () => {
        await queued();
        const lease = (await leases.claimQueued('worker'))!;
        await runs.markRunning(lease.executionId, new Date(), undefined, lease);
        await UserToolRun.updateOne({ executionId: lease.executionId }, { $set: { 'lease.expiresAt': new Date(0) } });
        expect(await leases.claimQueued('another-worker')).toBeNull();
        expect(await leases.renew(lease)).toBeNull();
        await expect(runs.completeRun(lease.executionId, {}, lease)).rejects.toBeInstanceOf(UserToolRunStateError);
        expect((await runs.getRunByExecutionId(lease.executionId))?.status).toBe('running');
    });

    it('fences every terminal transition after the lease expires', async () => {
        await queued();
        const lease = (await leases.claimQueued('worker'))!;
        await runs.markRunning(lease.executionId, new Date(), undefined, lease);
        await UserToolRun.updateOne({ executionId: lease.executionId }, { $set: { 'lease.expiresAt': new Date(0) } });
        await expect(runs.failRun(lease.executionId, { error: { message: 'failure' } }, lease)).rejects.toBeInstanceOf(UserToolRunStateError);
        await expect(runs.stopRun(lease.executionId, {}, lease)).rejects.toBeInstanceOf(UserToolRunStateError);
        await expect(runs.timeoutRun(lease.executionId, {}, lease)).rejects.toBeInstanceOf(UserToolRunStateError);
        expect((await runs.getRunByExecutionId(lease.executionId))?.status).toBe('running');
    });

    it('does not accept a lease issued for another execution', async () => {
        await queued();
        const lease = (await leases.claimQueued('worker'))!;
        await expect(runs.markRunning(lease.executionId, new Date(), undefined, { ...lease, executionId: 'other' }))
            .rejects.toBeInstanceOf(UserToolRunStateError);
    });

    it('renews and releases only a live queued claim', async () => {
        await queued();
        const lease = (await leases.claimQueued('worker'))!;
        expect(await leases.renew({ ...lease, owner: 'other' })).toBeNull();
        expect(await leases.renew(lease)).toMatchObject({ token: lease.token });
        expect(await leases.releaseQueued({ ...lease, token: 'wrong' })).toBe(false);
        expect(await leases.releaseQueued(lease)).toBe(true);
        expect(await leases.claimQueued('other')).toMatchObject({ executionId: lease.executionId });
    });

    it('prevents a cancelled queued claim from starting', async () => {
        const owner = new mongoose.Types.ObjectId();
        await runs.createQueuedRun({
            executionId: 'cancel-claimed', ownerUserId: owner, toolId: new mongoose.Types.ObjectId(),
            toolVersionTag: 'v1', toolContentHash: 'hash', launchContext: 'editor_test',
            runtime: 'typescript', policySnapshot: { networkMode: 'none' },
        });
        const lease = (await leases.claimQueued('worker'))!;
        expect((await runs.requestCancellation(lease.executionId, owner)).kind).toBe('stopped');
        expect(await leases.renew(lease)).toBeNull();
        await expect(runs.markRunning(lease.executionId, new Date(), undefined, lease)).rejects.toBeInstanceOf(UserToolRunStateError);
    });

    it('observes cancellation persistently while renewing a running lease', async () => {
        const owner = new mongoose.Types.ObjectId();
        await runs.createQueuedRun({
            executionId: 'cancel-running', ownerUserId: owner, toolId: new mongoose.Types.ObjectId(),
            toolVersionTag: 'v1', toolContentHash: 'hash', launchContext: 'editor_test',
            runtime: 'typescript', policySnapshot: { networkMode: 'none' },
        });
        const lease = (await leases.claimQueued('worker'))!;
        await runs.markRunning(lease.executionId, new Date(), undefined, lease);
        expect((await leases.renewAndObserve(lease)).kind).toBe('active');
        expect((await runs.requestCancellation(lease.executionId, owner)).kind).toBe('requested');
        expect((await leases.renewAndObserve(lease)).kind).toBe('cancellation_requested');
        await UserToolRun.updateOne({ executionId: lease.executionId }, { $set: { 'lease.expiresAt': new Date(0) } });
        expect((await leases.renewAndObserve(lease)).kind).toBe('lost');
    });

    it('validates lease configuration', async () => {
        expect(() => new MongoRunLeaseService(0)).toThrow(RangeError);
        expect(() => new MongoRunLeaseService(86_400_001)).toThrow(RangeError);
        await expect(leases.claimQueued('  ')).rejects.toThrow('Lease owner is required');
    });
});

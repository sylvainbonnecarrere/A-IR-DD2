import { logger } from '../../services/logger';
import mongoose from 'mongoose';
import { MongoRunLeaseService, type RunLease } from '../../services/runtime/MongoRunLeaseService';
import { UserToolRunService } from '../../services/userToolRun.service';

async function main(): Promise<void> {
  const uri = process.env.AIRDD2_REPLICA_TEST_URI;
  const action = process.argv[2];
  if (!uri || !action) throw new Error('Replica test URI and action are required');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5_000, connectTimeoutMS: 5_000, socketTimeoutMS: 20_000 });
  try {
    const leases = new MongoRunLeaseService(180_000);
    const runs = new UserToolRunService();
    let output: unknown;
    if (action === 'create-and-claim') {
      const executionId = process.env.AIRDD2_REPLICA_TEST_EXECUTION_ID;
      if (!executionId) throw new Error('Replica test execution ID is required');
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
      output = await leases.claimQueued('replica-worker');
    } else if (action === 'create-unconfirmed') {
      const executionId = process.env.AIRDD2_REPLICA_TEST_EXECUTION_ID;
      if (!executionId) throw new Error('Replica test execution ID is required');
      await runs.createQueuedRun({
        executionId: `${executionId}-unconfirmed`,
        ownerUserId: new mongoose.Types.ObjectId(),
        toolId: new mongoose.Types.ObjectId(),
        toolVersionTag: 'v1',
        toolContentHash: 'hash',
        launchContext: 'editor_test',
        runtime: 'typescript',
        policySnapshot: { networkMode: 'none' },
      });
      output = { status: 'queued' };
    } else if (action === 'cancel-queued') {
      const executionId = process.env.AIRDD2_REPLICA_TEST_EXECUTION_ID;
      if (!executionId) throw new Error('Replica test execution ID is required');
      const owner = new mongoose.Types.ObjectId();
      await runs.createQueuedRun({
        executionId: `${executionId}-cancelled`,
        ownerUserId: owner,
        toolId: new mongoose.Types.ObjectId(),
        toolVersionTag: 'v1',
        toolContentHash: 'hash',
        launchContext: 'editor_test',
        runtime: 'typescript',
        policySnapshot: { networkMode: 'none' },
      });
      output = { kind: (await runs.requestCancellation(`${executionId}-cancelled`, owner)).kind };
    } else if (action === 'cancel-running') {
      const executionId = process.env.AIRDD2_REPLICA_TEST_EXECUTION_ID;
      if (!executionId) throw new Error('Replica test execution ID is required');
      const run = await runs.getRunByExecutionId(executionId, 'majority');
      if (!run) throw new Error('Replica test run is missing');
      output = { kind: (await runs.requestCancellation(executionId, run.ownerUserId)).kind };
    } else if (action === 'claim') {
      output = await leases.claimQueued('competitor');
    } else if (action === 'start' || action === 'complete') {
      if (!process.env.AIRDD2_REPLICA_TEST_LEASE) throw new Error('Replica test lease is required');
      const lease: RunLease = JSON.parse(process.env.AIRDD2_REPLICA_TEST_LEASE);
      const run =
        action === 'start'
          ? await runs.markRunning(lease.executionId, new Date(), undefined, lease)
          : await runs.completeRun(lease.executionId, {}, lease);
      output = { status: run.status };
    } else {
      throw new Error('Unknown replica test action');
    }
    process.stdout.write(`\nAIRDD2_REPLICA_RESULT=${JSON.stringify(output)}\n`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error: unknown) => {
  logger.error(error instanceof Error ? `${error.name}: ${error.message}` : 'UnknownError');
  process.exitCode = 1;
});

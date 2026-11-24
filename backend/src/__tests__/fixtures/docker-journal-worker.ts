import { logger } from '../../services/logger';
import mongoose from 'mongoose';
import { MongoDockerOperationJournal } from '../../services/runtime/MongoDockerOperationJournal';
import { DockerAttemptReservation } from '../../services/runtime/DockerAttemptReservation';

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  const [executionId, attemptId, mode] = process.argv.slice(2);
  if (!uri || !executionId || !attemptId) throw new Error('Test MongoDB URI and attempt identity are required');
  await mongoose.connect(uri);
  try {
    const operation = await new MongoDockerOperationJournal().admit(
      {
        executionId,
        attemptId,
        containerName: DockerAttemptReservation.containerName(attemptId),
      },
      'create',
    );
    process.stdout.write(`${JSON.stringify(operation)}\n`);
    if (mode === 'wait') await new Promise<void>(() => undefined);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error: unknown) => {
  logger.error('worker error', error);
  process.exitCode = 1;
});

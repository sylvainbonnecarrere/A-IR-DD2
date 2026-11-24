import { logger } from '../../services/logger';
import mongoose from 'mongoose';
import { MongoWorkspaceLockService } from '../../services/runtime/MongoWorkspaceLockService';

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  const [userId, workflowId, owner] = process.argv.slice(2);
  if (!uri || !userId || !workflowId || !owner) {
    throw new Error('Test MongoDB URI, user, workflow and owner are required');
  }
  await mongoose.connect(uri);
  try {
    const lock = await new MongoWorkspaceLockService().tryAcquire(userId, workflowId, owner);
    process.stdout.write(JSON.stringify({ acquired: lock !== null }));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error: unknown) => {
  logger.error('worker error', error);
  process.exitCode = 1;
});

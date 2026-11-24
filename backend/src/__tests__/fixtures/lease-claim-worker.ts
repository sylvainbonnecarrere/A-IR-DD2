import { logger } from '../../services/logger';
import mongoose from 'mongoose';
import { MongoRunLeaseService } from '../../services/runtime/MongoRunLeaseService';

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  const owner = process.argv[2];
  if (!uri || !owner) {
    throw new Error('Test MongoDB URI and worker owner are required');
  }
  await mongoose.connect(uri);
  try {
    const lease = await new MongoRunLeaseService(30_000).claimQueued(owner);
    process.stdout.write(JSON.stringify({ claimed: lease !== null }));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error: unknown) => {
  logger.error('worker error', error);
  process.exitCode = 1;
});

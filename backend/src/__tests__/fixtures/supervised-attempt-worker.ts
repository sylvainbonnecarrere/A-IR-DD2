import { logger } from '../../services/logger';
import mongoose from 'mongoose';
import { MongoSupervisedAttemptService } from '../../services/runtime/MongoSupervisedAttemptService';

async function main(): Promise<void> {
  const { MONGODB_URI, TEST_ATTEMPT_EXECUTION, TEST_ATTEMPT_OWNER, TEST_ATTEMPT_TOKEN } = process.env;
  if (!MONGODB_URI || !TEST_ATTEMPT_EXECUTION || !TEST_ATTEMPT_OWNER || !TEST_ATTEMPT_TOKEN) {
    throw new Error('Isolated MongoDB URI and test lease identity are required');
  }
  await mongoose.connect(MONGODB_URI);
  try {
    const attempt = await new MongoSupervisedAttemptService().create({
      executionId: TEST_ATTEMPT_EXECUTION,
      owner: TEST_ATTEMPT_OWNER,
      token: TEST_ATTEMPT_TOKEN,
      expiresAt: new Date(0),
    });
    process.stdout.write(JSON.stringify({ created: true, attemptId: attempt.attemptId }));
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith('Supervised attempt was not created:')) {
      throw error;
    }
    process.stdout.write(JSON.stringify({ created: false }));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error: unknown) => {
  logger.error(error instanceof Error ? error.message : 'Unknown worker failure');
  process.exitCode = 1;
});

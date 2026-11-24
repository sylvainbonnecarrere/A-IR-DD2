import mongoose from 'mongoose';
import { SandboxService } from './services/sandbox.service';
import { UserToolQueryService } from './services/userToolQuery.service';

const userToolQueryService = new UserToolQueryService();
const sandboxService = new SandboxService();

/**
 * J7.4 — Execute a legacy function identifier through the canonical Tools V2 catalog.
 *
 * Flow:
 *  1. Load the canonical tool from DB (ownership: native/shared OR belongs to userId)
 *  2. Validate enabled status
 *  3. Adapt it to the runtime execution contract, enqueue durably, and await the worker result
 *
 * @param fnId    ObjectId string of the legacy function/tool identifier
 * @param args    Key/value map of function arguments
 * @param userId  Authenticated user id (for ownership gate)
 * @param agentId Optional agent id for context (audit / logging)
 */
export const executeFunctionById = async (
  fnId: string,
  args: Record<string, unknown>,
  userId: string,
  agentId?: string,
): Promise<object> => {
  // --- 1. Load from canonical catalog with ownership gate ---
  if (!mongoose.Types.ObjectId.isValid(fnId)) {
    throw new Error(`Invalid function id: ${fnId}`);
  }

  const tool = await userToolQueryService.getToolById(fnId, userId);

  if (!tool) {
    throw new Error(`Function '${fnId}' not found or access denied for user '${userId}'.`);
  }
  if (!tool.isEnabled) {
    throw new Error(`Function '${tool.name}' is disabled.`);
  }

  const acknowledgement = await sandboxService.queueFunctionRun({
    functionId: tool.id,
    userId,
    testArgs: args,
    launchContext: agentId ? 'workflow_run' : 'system_validation',
    agentInstanceId: agentId,
  });
  const result = await sandboxService.waitForRunCompletion(acknowledgement.executionId, userId);

  if (!result.success) {
    throw new Error(result.stderr || `Function '${tool.name}' failed.`);
  }

  return result.output as object;
};

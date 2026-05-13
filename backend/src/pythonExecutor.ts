import mongoose from 'mongoose';
import { UserFunction, IUserFunction } from './models/UserFunction.model';
import { syncUserToolMirrorFromLegacyFunction } from './services/userToolMirror.service';
import { ExecutionOrchestrator } from './services/runtime/ExecutionOrchestrator';
import { buildGlobalLegacyFunctionClauses, buildOwnedLegacyFunctionClause } from './utils/sharedExampleAccess';

const executionOrchestrator = new ExecutionOrchestrator();

/**
 * J7.4 — Execute a UserFunction (Tools V2) identified by its MongoDB _id.
 *
 * Flow:
 *  1. Load IUserFunction from DB (ownership: native OR belongs to userId)
 *  2. Validate enabled status
 *  3. Keep the legacy user_functions -> user_tools mirror convergent during transition
 *  4. Delegate execution to the sandbox orchestrator and return its output
 *
 * @param fnId    ObjectId string of the UserFunction document
 * @param args    Key/value map of function arguments
 * @param userId  Authenticated user id (for ownership gate)
 * @param agentId Optional agent id for context (audit / logging)
 */
export const executeFunctionById = async (
    fnId: string,
    args: Record<string, unknown>,
    userId: string,
    agentId?: string
): Promise<object> => {
    // --- 1. Load from DB with ownership gate ---
    if (!mongoose.Types.ObjectId.isValid(fnId)) {
        throw new Error(`Invalid function id: ${fnId}`);
    }

    const fn = await UserFunction.findOne({
        _id: new mongoose.Types.ObjectId(fnId),
        $or: [
            ...buildGlobalLegacyFunctionClauses(),
            buildOwnedLegacyFunctionClause(userId)
        ]
    }).lean<IUserFunction>();

    if (!fn) {
        throw new Error(`Function '${fnId}' not found or access denied for user '${userId}'.`);
    }
    if (!fn.isEnabled) {
        throw new Error(`Function '${fn.name}' is disabled.`);
    }

    await syncUserToolMirrorFromLegacyFunction(fn).catch((error) => {
        console.warn('[pythonExecutor] user_tools mirror sync warning:', error instanceof Error ? error.message : String(error));
    });

    const result = await executionOrchestrator.execute({
        fn,
        userId,
        args,
        launchContext: agentId ? 'workflow_run' : 'system_validation',
        agentInstanceId: agentId
    });

    if (!result.success) {
        throw new Error(result.stderr || `Function '${fn.name}' failed.`);
    }

    return result.output as object;
};

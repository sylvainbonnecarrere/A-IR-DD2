import mongoose from 'mongoose';
import { ExecutionOrchestrator, type ExecutionOrchestratorRequest } from './services/runtime/ExecutionOrchestrator';
import { UserToolQueryService, type ToolTransitionReadModel } from './services/userToolQuery.service';

const executionOrchestrator = new ExecutionOrchestrator();
const userToolQueryService = new UserToolQueryService();

function parseLegacyVersion(versionTag?: string | null): number {
    if (!versionTag) {
        return 1;
    }

    const match = versionTag.match(/(\d+)/);
    return match ? Number.parseInt(match[1], 10) : 1;
}

function mapToolToExecutionFunction(tool: ToolTransitionReadModel): ExecutionOrchestratorRequest['fn'] {
    return {
        _id: tool.id,
        name: tool.name,
        language: tool.runtime,
        origin: tool.origin,
        codeInline: tool.currentVersion?.sourceInline ?? null,
        codePath: tool.currentVersion?.sourcePath ?? null,
        workflowId: tool.workflowId ?? null,
        dependencies: tool.dependencies,
        version: parseLegacyVersion(tool.currentVersion?.versionTag),
        toolVersionTag: tool.currentVersion?.versionTag,
        toolContentHash: tool.currentVersion?.contentHash,
        policySnapshot: tool.policy
    };
}

/**
 * J7.4 — Execute a legacy function identifier through the canonical Tools V2 catalog.
 *
 * Flow:
 *  1. Load the canonical tool from DB (ownership: native/shared OR belongs to userId)
 *  2. Validate enabled status
 *  3. Adapt it to the runtime execution contract and delegate to the sandbox orchestrator
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
    agentId?: string
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

    const fn = mapToolToExecutionFunction(tool);

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

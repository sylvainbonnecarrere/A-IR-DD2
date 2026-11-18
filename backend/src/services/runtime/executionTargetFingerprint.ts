import { createHash } from 'crypto';
import type { ExecutionFunctionRef } from './execution.types';

export function executionTargetFingerprint(fn: ExecutionFunctionRef): string {
    const dependencies = fn.dependencies;
    const normalizedDependencies = Array.isArray(dependencies)
        ? { python: fn.language === 'python' ? dependencies : [], npm: fn.language === 'typescript' ? dependencies : [] }
        : { python: dependencies?.python ?? [], npm: dependencies?.npm ?? [] };
    const policy = fn.policySnapshot;
    return createHash('sha256').update(JSON.stringify({
        version: 1,
        toolId: fn._id.toString(),
        name: fn.name,
        runtime: fn.language,
        origin: fn.origin,
        workflowId: fn.workflowId?.toString() ?? null,
        versionTag: fn.toolVersionTag ?? null,
        contentHash: fn.toolContentHash ?? null,
        sourceInline: fn.codeInline ?? null,
        sourcePath: typeof fn.codeInline === 'string' ? null : fn.codePath ?? null,
        dependencies: normalizedDependencies,
        policy: policy ? {
            networkMode: policy.networkMode,
            writablePaths: [...(policy.writablePaths ?? [])].sort(),
            secretAliases: [...(policy.secretAliases ?? [])].sort(),
            timeoutSeconds: policy.timeoutSeconds ?? null,
            maxMemoryMb: policy.maxMemoryMb ?? null,
        } : null,
    })).digest('hex');
}

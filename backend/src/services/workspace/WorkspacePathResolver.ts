import path from 'path';
import type { WorkspaceResolvedPaths, WorkspaceScopeRef } from './types';

function sanitizeSegment(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export class WorkspacePathResolver {
    constructor(
        private readonly workspaceStorageRoot: string = path.resolve(
            process.env.WORKSPACE_STORAGE_PATH ?? path.join(process.cwd(), 'storage', 'workspaces')
        )
    ) {}

    resolve(scope: WorkspaceScopeRef): WorkspaceResolvedPaths {
        const ownerUserId = sanitizeSegment(scope.ownerUserId);
        const scopeId = sanitizeSegment(scope.scopeId);
        const logicalRoot = path.join(
            this.workspaceStorageRoot,
            'users',
            ownerUserId,
            `${scope.scopeType}s`,
            scopeId
        );

        return {
            storageRoot: this.workspaceStorageRoot,
            logicalRoot,
            runtimeRoots: {
                sourceRoot: path.join(logicalRoot, 'source'),
                manifestsRoot: path.join(logicalRoot, 'manifests'),
                buildRoot: path.join(logicalRoot, 'build'),
                outputRoot: path.join(logicalRoot, 'output')
            }
        };
    }
}
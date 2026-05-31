import path from 'path';
import { IMediaReference } from '../models/MediaReference.model';
import { getMediaStorageService } from './mediaStorage.service';
import { WorkspacePathResolver } from './workspace/WorkspacePathResolver';

const DEFAULT_LEGACY_MEDIA_STORAGE_ROOT = process.env.MEDIA_STORAGE_PATH || path.join(process.cwd(), 'storage');

export interface ResolvedMediaLocalPath {
    normalizedPath: string;
    absolutePath: string;
    storageZone: 'legacy' | 'workspace';
}

export function validateWorkspaceOutputPath(relativePath: string): boolean {
    const normalized = path.normalize(relativePath).replace(/\\/g, '/');

    if (normalized.includes('..')) {
        return false;
    }

    if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
        return false;
    }

    return normalized.startsWith('output/');
}

export function resolveWorkflowOutputRoot(
    ownerUserId: string,
    workflowId: string,
    pathResolver: WorkspacePathResolver = new WorkspacePathResolver(),
): string {
    return pathResolver.resolve({
        ownerUserId,
        scopeType: 'workflow',
        scopeId: workflowId,
    }).runtimeRoots.outputRoot;
}

export function resolveAgentWorkspaceMediaDirectory(
    ownerUserId: string,
    workflowId: string,
    agentInstanceId: string,
    pathResolver: WorkspacePathResolver = new WorkspacePathResolver(),
): string {
    return path.join(resolveWorkflowOutputRoot(ownerUserId, workflowId, pathResolver), 'media', 'agents', agentInstanceId);
}

export function resolveMediaReferenceLocalPath(
    mediaRef: Pick<IMediaReference, 'localPath' | 'workflowId'>,
    ownerUserId: string,
    pathResolver: WorkspacePathResolver = new WorkspacePathResolver(),
): ResolvedMediaLocalPath | null {
    if (!mediaRef.localPath) {
        return null;
    }

    const normalizedPath = path.normalize(mediaRef.localPath).replace(/\\/g, '/');
    if (normalizedPath.startsWith('users/')) {
        if (!getMediaStorageService().validatePath(normalizedPath, ownerUserId)) {
            return null;
        }

        return {
            normalizedPath,
            absolutePath: path.join(DEFAULT_LEGACY_MEDIA_STORAGE_ROOT, normalizedPath),
            storageZone: 'legacy',
        };
    }

    if (!validateWorkspaceOutputPath(normalizedPath)) {
        return null;
    }

    const outputRoot = resolveWorkflowOutputRoot(ownerUserId, mediaRef.workflowId.toString(), pathResolver);

    return {
        normalizedPath,
        absolutePath: path.join(outputRoot, normalizedPath.slice('output/'.length)),
        storageZone: 'workspace',
    };
}
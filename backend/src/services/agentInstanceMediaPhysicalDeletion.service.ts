import { access, readdir, rmdir, unlink } from 'fs/promises';
import path from 'path';
import { IMediaReference } from '../models/MediaReference.model';
import { resolveCloudAccessForMediaReference } from './cloudMediaAccess.service';
import {
    resolveAgentWorkspaceMediaDirectory,
    resolveMediaReferenceLocalPath,
} from './mediaLocalPath.service';

export type MediaDeleteOutcome = 'deleted' | 'missing' | 'unresolved';

export class AgentInstanceMediaPhysicalDeletionService {
    async deleteMediaReference(mediaReference: IMediaReference, userId: string): Promise<MediaDeleteOutcome | null> {
        if (mediaReference.storageMode === 'cloud') {
            return this.deleteCloudMedia(mediaReference, userId);
        }

        if (mediaReference.storageMode !== 'local') {
            return null;
        }

        return this.deleteLocalMedia(mediaReference, userId);
    }

    async deleteWorkspaceAgentMedia(ownerUserId: string, workflowId: string, agentInstanceId: string): Promise<number> {
        const agentMediaDirectory = resolveAgentWorkspaceMediaDirectory(ownerUserId, workflowId, agentInstanceId);

        try {
            await access(agentMediaDirectory);
        } catch {
            return 0;
        }

        return this.deleteDirectoryRecursive(agentMediaDirectory);
    }

    private async deleteLocalMedia(mediaReference: IMediaReference, userId: string): Promise<MediaDeleteOutcome> {
        const resolvedPath = resolveMediaReferenceLocalPath(mediaReference, userId);
        if (!resolvedPath) {
            return 'unresolved';
        }

        try {
            await access(resolvedPath.absolutePath);
        } catch {
            return 'missing';
        }

        try {
            await unlink(resolvedPath.absolutePath);
            return 'deleted';
        } catch {
            return 'unresolved';
        }
    }

    private async deleteCloudMedia(mediaReference: IMediaReference, userId: string): Promise<MediaDeleteOutcome> {
        if (!mediaReference.cloudKey) {
            return 'unresolved';
        }

        try {
            const { strategy } = await resolveCloudAccessForMediaReference(mediaReference, userId);
            const deleted = await strategy.delete(mediaReference.cloudKey);
            return deleted ? 'deleted' : 'unresolved';
        } catch (error) {
            console.warn('[AgentInstanceMediaPhysicalDeletionService] cloud media delete failed:', error);
            return 'unresolved';
        }
    }

    private async deleteDirectoryRecursive(dirPath: string): Promise<number> {
        let deletedFiles = 0;

        try {
            const entries = await readdir(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);

                if (entry.isDirectory()) {
                    deletedFiles += await this.deleteDirectoryRecursive(fullPath);
                } else {
                    await unlink(fullPath);
                    deletedFiles += 1;
                }
            }

            await rmdir(dirPath);
            return deletedFiles;
        } catch (error) {
            console.warn('[AgentInstanceMediaPhysicalDeletionService] workspace media directory delete failed:', error);
            return deletedFiles;
        }
    }
}
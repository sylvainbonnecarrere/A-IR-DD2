import crypto from 'crypto';
import { promises as fs } from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import {
    ALLOWED_MIME_TYPES,
    FileMetadata,
    MediaPayload,
} from '../../types/persistence';
import { MediaStorageError } from '../mediaStorage.service';
import { createWorkspaceManager, WorkspaceManager } from './WorkspaceManager';

export interface WorkspacePublicationContext {
    userId: string;
    workflowId: string;
    agentInstanceId: string;
}

type AllowedMimeType = typeof ALLOWED_MIME_TYPES[number];

function isAllowedMimeType(mimeType: string): mimeType is AllowedMimeType {
    return (ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType);
}

export class WorkspacePublicationService {
    constructor(
        private readonly workspaceManager: WorkspaceManager = createWorkspaceManager(),
    ) {}

    canPublishToWorkflowWorkspace(context: WorkspacePublicationContext): boolean {
        return mongoose.Types.ObjectId.isValid(context.userId)
            && mongoose.Types.ObjectId.isValid(context.workflowId);
    }

    async publishPrimaryWorkspaceMedia(
        file: Buffer,
        metadata: FileMetadata,
        context: WorkspacePublicationContext,
    ): Promise<MediaPayload> {
        this.validateMimeType(metadata.mimeType);

        const workspace = await this.workspaceManager.ensureWorkflowWorkspace(context.userId, context.workflowId);
        const checksum = this.generateChecksum(file);
        const now = new Date();
        const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const uniqueFileName = this.generateUniqueFileName(metadata.originalName);
        const agentDirectory = this.sanitizePathSegment(context.agentInstanceId) || 'agent';

        const relativeFilePath = path.posix.join(
            'output',
            'media',
            'agents',
            agentDirectory,
            yearMonth,
            uniqueFileName,
        );

        const absolutePath = path.join(
            workspace.runtimeRoots.outputRoot,
            'media',
            'agents',
            agentDirectory,
            yearMonth,
            uniqueFileName,
        );

        await fs.mkdir(path.dirname(absolutePath), { recursive: true });

        try {
            await fs.writeFile(absolutePath, file);
        } catch (error) {
            throw new MediaStorageError(
                `Erreur d'écriture du fichier workspace: ${error instanceof Error ? error.message : 'Unknown'}`,
                'WRITE_ERROR',
                { path: absolutePath },
            );
        }

        return {
            mimeType: metadata.mimeType,
            fileName: uniqueFileName,
            size: file.length,
            storageMode: 'local',
            path: relativeFilePath,
            checksum,
            metadata: {
                generatedBy: metadata.generatedBy,
                prompt: metadata.prompt,
                storedAt: now.toISOString(),
            },
        };
    }

    private validateMimeType(mimeType: string): void {
        if (!isAllowedMimeType(mimeType)) {
            throw new MediaStorageError(
                `Type MIME non autorisé: ${mimeType}`,
                'INVALID_MIME_TYPE',
                { mimeType, allowed: ALLOWED_MIME_TYPES },
            );
        }
    }

    private generateChecksum(buffer: Buffer): string {
        return crypto.createHash('sha256').update(buffer).digest('hex');
    }

    private generateUniqueFileName(originalName: string): string {
        const sanitized = this.sanitizeFileName(originalName);
        const extension = path.extname(sanitized);
        const baseName = path.basename(sanitized, extension);
        const timestamp = Date.now();
        const randomSuffix = crypto.randomBytes(4).toString('hex');

        return `${baseName}-${timestamp}-${randomSuffix}${extension}`;
    }

    private sanitizeFileName(fileName: string): string {
        const normalized = fileName.normalize('NFKD').replace(/[^\x00-\x7F]/g, '');
        const cleaned = normalized
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
            .replace(/\.{2,}/g, '.')
            .replace(/^\.+/, '')
            .trim();

        return cleaned || 'media-file';
    }

    private sanitizePathSegment(value: string): string {
        return value.replace(/[^a-zA-Z0-9_-]/g, '_');
    }
}
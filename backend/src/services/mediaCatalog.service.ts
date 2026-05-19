import { stat } from 'fs/promises';
import path from 'path';
import { IMediaReference, IUserToolRunArtifact } from '../models';
import {
    CreateMediaReferenceFromJournalParams,
    MediaReferenceRepository,
    UpsertRuntimeArtifactParams,
} from '../repositories/MediaReferenceRepository';

export interface RegisterRuntimeOutputArtifactsParams {
    userId: string;
    workflowId: string;
    agentInstanceId: string;
    executionId: string;
    workspaceOutputRoot: string;
    artifacts: IUserToolRunArtifact[];
    agentName?: string;
}

export class MediaCatalogService {
    constructor(
        private readonly mediaReferenceRepository: MediaReferenceRepository = new MediaReferenceRepository(),
    ) {}

    async registerJournalMedia(params: CreateMediaReferenceFromJournalParams): Promise<IMediaReference> {
        return this.mediaReferenceRepository.createFromJournalMedia(params);
    }

    async registerRuntimeOutputArtifacts(params: RegisterRuntimeOutputArtifactsParams): Promise<IMediaReference[]> {
        const registeredArtifacts: IMediaReference[] = [];

        for (const artifact of params.artifacts) {
            const runtimeArtifact = await this.resolveRuntimeArtifactMetadata(artifact, params.workspaceOutputRoot);
            if (!runtimeArtifact) {
                continue;
            }

            registeredArtifacts.push(
                await this.mediaReferenceRepository.upsertRuntimeArtifact({
                    userId: params.userId,
                    workflowId: params.workflowId,
                    agentInstanceId: params.agentInstanceId,
                    executionId: params.executionId,
                    agentName: params.agentName,
                    ...runtimeArtifact,
                }),
            );
        }

        return registeredArtifacts;
    }

    private async resolveRuntimeArtifactMetadata(
        artifact: IUserToolRunArtifact,
        workspaceOutputRoot: string,
    ): Promise<Omit<UpsertRuntimeArtifactParams, 'userId' | 'workflowId' | 'agentInstanceId' | 'executionId' | 'agentName'> | null> {
        const localPath = this.normalizeRuntimeArtifactPath(artifact.path);
        if (!localPath) {
            return null;
        }

        const relativeOutputPath = localPath.slice('output/'.length);
        const absolutePath = path.join(workspaceOutputRoot, ...relativeOutputPath.split('/'));

        let artifactStats;
        try {
            artifactStats = await stat(absolutePath);
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code === 'ENOENT') {
                return null;
            }

            throw error;
        }

        if (!artifactStats.isFile()) {
            return null;
        }

        const fileName = path.posix.basename(localPath);

        return {
            localPath,
            fileName,
            originalName: fileName,
            mimeType: this.inferArtifactMimeType(artifact, fileName),
            size: artifactStats.size,
        };
    }

    private normalizeRuntimeArtifactPath(artifactPath: string): string | null {
        const normalized = path.posix.normalize((artifactPath || '').replace(/\\/g, '/'));
        if (!normalized.startsWith('output/')) {
            return null;
        }

        return normalized;
    }

    private inferArtifactMimeType(artifact: IUserToolRunArtifact, fileName: string): string {
        if (artifact.kind === 'json') {
            return 'application/json';
        }

        if (artifact.kind === 'log') {
            return 'text/plain';
        }

        const extension = path.posix.extname(fileName).toLowerCase();

        switch (extension) {
            case '.png':
                return 'image/png';
            case '.jpg':
            case '.jpeg':
                return 'image/jpeg';
            case '.gif':
                return 'image/gif';
            case '.webp':
                return 'image/webp';
            case '.svg':
                return 'image/svg+xml';
            case '.txt':
            case '.md':
            case '.log':
            case '.csv':
                return 'text/plain';
            case '.pdf':
                return 'application/pdf';
            default:
                return 'application/octet-stream';
        }
    }
}
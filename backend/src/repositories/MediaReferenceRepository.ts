import { Types } from 'mongoose';
import {
    IMediaReference,
    IMediaReferenceCreate,
    MediaProvenance,
    MediaReference,
    MediaStorageMode as CatalogMediaStorageMode,
} from '../models/MediaReference.model';
import { MediaPayload } from '../types/persistence';

function derivePrimaryStorageMode(storageMode: CatalogMediaStorageMode): 'db' | 'workspace' | 'cloud' {
    switch (storageMode) {
        case 'local':
            return 'workspace';
        case 'cloud':
            return 'cloud';
        case 'db':
        default:
            return 'db';
    }
}

function buildCanonicalLocator(params: {
    storageMode: CatalogMediaStorageMode;
    journalEntryId: string;
    localPath?: string;
    cloudKey?: string;
    cloudProvider?: 's3' | 'gcs';
    cloudBucket?: string;
}): string {
    switch (params.storageMode) {
        case 'local':
            if (!params.localPath) {
                throw new Error('localPath requis pour construire un locator workspace');
            }
            return `workspace://${params.localPath}`;
        case 'cloud':
            if (!params.cloudKey) {
                throw new Error('cloudKey requis pour construire un locator cloud');
            }
            if (params.cloudProvider && params.cloudBucket) {
                return `${params.cloudProvider}://${params.cloudBucket}/${params.cloudKey}`;
            }
            return `cloud://${params.cloudKey}`;
        case 'db':
        default:
            return `journal://${params.journalEntryId}`;
    }
}

export interface CreateMediaReferenceFromJournalParams {
    userId: string;
    workflowId: string;
    agentInstanceId: string;
    journalEntryId: string;
    fileName: string;
    originalName: string;
    mimeType: string;
    size: number;
    checksum?: string;
    generatedBy?: string;
    prompt?: string;
    modelUsed?: string;
    createdByAgentName?: string;
    lastModifiedByAgentName?: string;
    mediaPayload: MediaPayload;
}

export interface UpsertRuntimeArtifactParams {
    userId: string;
    workflowId: string;
    agentInstanceId: string;
    executionId: string;
    localPath: string;
    fileName: string;
    originalName: string;
    mimeType: string;
    size: number;
    checksum?: string;
    agentName?: string;
}

export class MediaReferenceRepository {
    async createFromJournalMedia(params: CreateMediaReferenceFromJournalParams): Promise<IMediaReference> {
        const storageMode = this.mapStorageMode(params.mediaPayload.storageMode);
        const cloudMetadata = params.mediaPayload.metadata as Record<string, unknown> | undefined;
        const cloudKey = typeof cloudMetadata?.cloudKey === 'string' ? cloudMetadata.cloudKey : undefined;
        const cloudProvider = this.isCloudProvider(cloudMetadata?.cloudProvider)
            ? cloudMetadata.cloudProvider
            : undefined;
        const cloudBucket = typeof cloudMetadata?.cloudBucket === 'string' ? cloudMetadata.cloudBucket : undefined;
        const cloudConnectionProfileId = typeof cloudMetadata?.cloudConnectionProfileId === 'string'
            && cloudMetadata.cloudConnectionProfileId.trim().length > 0
            ? cloudMetadata.cloudConnectionProfileId.trim()
            : undefined;

        const document: IMediaReferenceCreate = {
            userId: new Types.ObjectId(params.userId),
            workflowId: new Types.ObjectId(params.workflowId),
            agentInstanceId: new Types.ObjectId(params.agentInstanceId),
            journalEntryId: new Types.ObjectId(params.journalEntryId),
            storageMode,
            primaryStorageMode: derivePrimaryStorageMode(storageMode),
            canonicalLocator: buildCanonicalLocator({
                storageMode,
                journalEntryId: params.journalEntryId,
                localPath: params.mediaPayload.path,
                cloudKey,
                cloudProvider,
                cloudBucket,
            }),
            fileName: params.fileName,
            originalName: params.originalName,
            mimeType: params.mimeType,
            size: params.size,
            checksum: params.checksum,
            generatedBy: params.generatedBy,
            prompt: params.prompt,
            modelUsed: params.modelUsed,
            createdByAgentInstanceId: new Types.ObjectId(params.agentInstanceId),
            createdByAgentName: params.createdByAgentName,
            lastModifiedByAgentInstanceId: new Types.ObjectId(params.agentInstanceId),
            lastModifiedByAgentName: params.lastModifiedByAgentName,
            isOrphan: false,
        };

        if (storageMode === 'local') {
            document.localPath = params.mediaPayload.path;
        }

        if (storageMode === 'cloud') {
            document.cloudKey = cloudKey;
            document.cloudProvider = cloudProvider;
            document.cloudBucket = cloudBucket;
            document.cloudConnectionProfileId = cloudConnectionProfileId;
        }

        return MediaReference.create(document);
    }

    async upsertRuntimeArtifact(params: UpsertRuntimeArtifactParams): Promise<IMediaReference> {
        const userId = new Types.ObjectId(params.userId);
        const workflowId = new Types.ObjectId(params.workflowId);
        const agentInstanceId = new Types.ObjectId(params.agentInstanceId);
        const canonicalLocator = buildCanonicalLocator({
            storageMode: 'local',
            journalEntryId: params.executionId,
            localPath: params.localPath,
        });

        const $set: Record<string, unknown> = {
            agentInstanceId,
            storageMode: 'local',
            primaryStorageMode: 'workspace',
            canonicalLocator,
            localPath: params.localPath,
            fileName: params.fileName,
            originalName: params.originalName,
            mimeType: params.mimeType,
            size: params.size,
            provenance: 'runtime_output' satisfies MediaProvenance,
            sourceExecutionId: params.executionId,
            lastModifiedByAgentInstanceId: agentInstanceId,
            isOrphan: false,
        };

        if (params.agentName) {
            $set.lastModifiedByAgentName = params.agentName;
        }

        const $setOnInsert: Record<string, unknown> = {
            userId,
            workflowId,
            createdByAgentInstanceId: agentInstanceId,
        };

        if (params.agentName) {
            $setOnInsert.createdByAgentName = params.agentName;
        }

        const $unset: Record<string, unknown> = {
            orphanedAt: 1,
            orphanReason: 1,
        };

        if (params.checksum) {
            $set.checksum = params.checksum;
        } else {
            $unset.checksum = 1;
        }

        const mediaReference = await MediaReference.findOneAndUpdate(
            {
                userId,
                workflowId,
                canonicalLocator,
            },
            {
                $set,
                $setOnInsert,
                $unset,
            },
            {
                upsert: true,
                new: true,
                runValidators: true,
                setDefaultsOnInsert: true,
            },
        );

        if (!mediaReference) {
            throw new Error(`Failed to upsert runtime artifact catalog entry for ${canonicalLocator}`);
        }

        return mediaReference;
    }

    private mapStorageMode(storageMode: MediaPayload['storageMode']): CatalogMediaStorageMode {
        switch (storageMode) {
            case 'local':
                return 'local';
            case 'cloud':
                return 'cloud';
            case 'database':
            default:
                return 'db';
        }
    }

    private isCloudProvider(value: unknown): value is 's3' | 'gcs' {
        return value === 's3' || value === 'gcs';
    }
}
import { Types } from 'mongoose';
import {
    IMediaReference,
    IMediaReferenceCreate,
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

export class MediaReferenceRepository {
    async createFromJournalMedia(params: CreateMediaReferenceFromJournalParams): Promise<IMediaReference> {
        const storageMode = this.mapStorageMode(params.mediaPayload.storageMode);
        const cloudMetadata = params.mediaPayload.metadata as Record<string, unknown> | undefined;
        const cloudKey = typeof cloudMetadata?.cloudKey === 'string' ? cloudMetadata.cloudKey : undefined;
        const cloudProvider = this.isCloudProvider(cloudMetadata?.cloudProvider)
            ? cloudMetadata.cloudProvider
            : undefined;
        const cloudBucket = typeof cloudMetadata?.cloudBucket === 'string' ? cloudMetadata.cloudBucket : undefined;

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
        }

        return MediaReference.create(document);
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
import { ClientSession, Types } from 'mongoose';
import {
    buildMediaReferenceCanonicalLocator,
    deriveMediaReferencePrimaryStorageMode,
    IMediaReference,
    IMediaReferenceCreate,
    MediaReferenceJournalContractComparable,
    MediaProvenance,
    MediaReference,
    MediaStorageMode as CatalogMediaStorageMode,
    resolveMediaReferenceCatalogSeedFromJournalMedia,
} from '../models/MediaReference.model';
import { MediaPayload } from '../types/persistence';

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
    session?: ClientSession;
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
    session?: ClientSession;
}

export interface FindJournalReferencesParams {
    userId: Types.ObjectId;
    workflowId: Types.ObjectId;
    journalEntryIds: Types.ObjectId[];
    session?: ClientSession;
}

export interface JournalMediaReferenceShape extends MediaReferenceJournalContractComparable {
    journalEntryId?: Types.ObjectId;
}

export class MediaReferenceRepository {
    async findJournalReferences(params: FindJournalReferencesParams): Promise<JournalMediaReferenceShape[]> {
        if (params.journalEntryIds.length === 0) {
            return [];
        }

        const query = MediaReference.find({
            userId: params.userId,
            workflowId: params.workflowId,
            journalEntryId: {
                $in: params.journalEntryIds,
            },
        })
            .select('journalEntryId storageMode primaryStorageMode canonicalLocator localPath cloudConnectionProfileId cloudKey cloudProvider cloudBucket')
            .lean<JournalMediaReferenceShape[]>();

        if (params.session) {
            query.session(params.session);
        }

        return query;
    }

    async createFromJournalMedia(params: CreateMediaReferenceFromJournalParams): Promise<IMediaReference> {
        const userId = new Types.ObjectId(params.userId);
        const workflowId = new Types.ObjectId(params.workflowId);
        const agentInstanceId = new Types.ObjectId(params.agentInstanceId);
        const journalEntryId = new Types.ObjectId(params.journalEntryId);
        const catalogSeed = resolveMediaReferenceCatalogSeedFromJournalMedia({
            journalEntryId,
            mediaPayload: params.mediaPayload,
        });

        if (!catalogSeed) {
            throw new Error(`Unable to derive canonicalLocator for journal media ${params.journalEntryId}`);
        }

        const document: IMediaReferenceCreate = {
            userId,
            workflowId,
            agentInstanceId,
            journalEntryId,
            storageMode: catalogSeed.storageMode,
            primaryStorageMode: catalogSeed.primaryStorageMode,
            canonicalLocator: catalogSeed.canonicalLocator,
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

        if (catalogSeed.storageMode === 'local') {
            document.localPath = catalogSeed.localPath;
        }

        if (catalogSeed.storageMode === 'cloud') {
            document.cloudKey = catalogSeed.cloudKey;
            document.cloudProvider = catalogSeed.cloudProvider;
            document.cloudBucket = catalogSeed.cloudBucket;
            document.cloudConnectionProfileId = catalogSeed.cloudConnectionProfileId;
        }

        const mediaReference = await MediaReference.findOneAndUpdate(
            {
                userId,
                workflowId,
                journalEntryId,
            },
            {
                $set: document,
            },
            {
                upsert: true,
                new: true,
                runValidators: true,
                setDefaultsOnInsert: true,
                ...(params.session ? { session: params.session } : {}),
            },
        );

        if (!mediaReference) {
            throw new Error(`Failed to upsert journal media catalog entry for ${params.journalEntryId}`);
        }

        return mediaReference;
    }

    async upsertRuntimeArtifact(params: UpsertRuntimeArtifactParams): Promise<IMediaReference> {
        const userId = new Types.ObjectId(params.userId);
        const workflowId = new Types.ObjectId(params.workflowId);
        const agentInstanceId = new Types.ObjectId(params.agentInstanceId);
        const canonicalLocator = buildMediaReferenceCanonicalLocator({
            storageMode: 'local',
            localPath: params.localPath,
        });

        if (!canonicalLocator) {
            throw new Error(`Unable to derive canonicalLocator for runtime artifact ${params.localPath}`);
        }

        const $set: Record<string, unknown> = {
            agentInstanceId,
            storageMode: 'local',
            primaryStorageMode: deriveMediaReferencePrimaryStorageMode('local'),
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
                ...(params.session ? { session: params.session } : {}),
            },
        );

        if (!mediaReference) {
            throw new Error(`Failed to upsert runtime artifact catalog entry for ${canonicalLocator}`);
        }

        return mediaReference;
    }
}
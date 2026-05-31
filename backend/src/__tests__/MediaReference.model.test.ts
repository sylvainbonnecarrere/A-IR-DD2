import mongoose from 'mongoose';
import {
    MediaReference,
    mediaReferenceMatchesJournalMediaContract,
    resolveMediaReferenceCatalogSeedFromJournalMedia,
    resolvePersistedMediaReferencePrimaryStorageMode,
} from '../models/MediaReference.model';

describe('MediaReference additive DDD fields', () => {
    it('derives canonical contract fields before validation and normalizes audit defaults', async () => {
        const userId = new mongoose.Types.ObjectId();
        const workflowId = new mongoose.Types.ObjectId();
        const agentInstanceId = new mongoose.Types.ObjectId();

        const media = await MediaReference.create({
            userId,
            workflowId,
            agentInstanceId,
            storageMode: 'local',
            primaryStorageMode: 'db',
            localPath: 'output/media/agents/agent-1/2026-05/image.png',
            canonicalLocator: 'journal://stale-locator',
            fileName: 'image.png',
            originalName: 'image-original.png',
            mimeType: 'image/png',
            size: 42,
            createdByAgentInstanceId: agentInstanceId,
            createdByAgentName: 'Archi',
            isOrphan: false,
            orphanReason: 'agent_deleted',
        });

        expect(media.toObject()).toEqual(expect.objectContaining({
            canonicalLocator: 'workspace://output/media/agents/agent-1/2026-05/image.png',
            primaryStorageMode: 'workspace',
            createdByAgentName: 'Archi',
            lastModifiedByAgentName: 'Archi',
            isOrphan: false,
        }));
        expect(media.lastModifiedByAgentInstanceId?.toString()).toBe(agentInstanceId.toString());
        expect(media.orphanReason).toBeUndefined();
        expect(media.orphanedAt).toBeUndefined();
    });

    it('centralizes journal media contract resolution and matching for local and cloud payloads', () => {
        const journalEntryId = new mongoose.Types.ObjectId();

        const localPayload = {
            storageMode: 'local',
            path: 'output/media/agents/agent-1/2026-05/image.png',
            metadata: {},
        } as any;

        expect(resolveMediaReferenceCatalogSeedFromJournalMedia({
            journalEntryId,
            mediaPayload: localPayload,
        })).toEqual(expect.objectContaining({
            storageMode: 'local',
            primaryStorageMode: 'workspace',
            canonicalLocator: 'workspace://output/media/agents/agent-1/2026-05/image.png',
            localPath: 'output/media/agents/agent-1/2026-05/image.png',
        }));

        expect(mediaReferenceMatchesJournalMediaContract({
            storageMode: 'local',
            primaryStorageMode: 'workspace',
            canonicalLocator: 'workspace://output/media/agents/agent-1/2026-05/image.png',
            localPath: 'output/media/agents/agent-1/2026-05/image.png',
        }, {
            journalEntryId,
            mediaPayload: localPayload,
        })).toBe(true);

        expect(mediaReferenceMatchesJournalMediaContract({
            storageMode: 'local',
            primaryStorageMode: 'workspace',
            canonicalLocator: 'workspace://stale/location.png',
            localPath: 'stale/location.png',
        }, {
            journalEntryId,
            mediaPayload: localPayload,
        })).toBe(false);

        const cloudPayload = {
            storageMode: 'cloud',
            metadata: {
                cloudKey: 'tenant/workflows/cloud-image.png',
                cloudProvider: 's3',
                cloudBucket: 'media-bucket',
                cloudConnectionProfileId: 'profile-1',
            },
        } as any;

        expect(mediaReferenceMatchesJournalMediaContract({
            storageMode: 'cloud',
            primaryStorageMode: 'cloud',
            canonicalLocator: 's3://media-bucket/tenant/workflows/cloud-image.png',
            cloudKey: 'tenant/workflows/cloud-image.png',
            cloudProvider: 's3',
            cloudBucket: 'media-bucket',
            cloudConnectionProfileId: 'profile-1',
        }, {
            journalEntryId,
            mediaPayload: cloudPayload,
        })).toBe(true);

        expect(mediaReferenceMatchesJournalMediaContract({
            storageMode: 'cloud',
            primaryStorageMode: 'cloud',
            canonicalLocator: 's3://media-bucket/tenant/workflows/cloud-image.png',
            cloudKey: 'tenant/workflows/cloud-image.png',
            cloudProvider: 's3',
            cloudBucket: 'media-bucket',
            cloudConnectionProfileId: 'profile-stale',
        }, {
            journalEntryId,
            mediaPayload: cloudPayload,
        })).toBe(false);

        expect(resolvePersistedMediaReferencePrimaryStorageMode({
            storageMode: 'local',
        })).toBe('workspace');
    });
});
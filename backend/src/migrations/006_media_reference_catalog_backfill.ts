import mongoose from 'mongoose';
import {
    buildMediaReferenceCanonicalLocator,
    deriveMediaReferencePrimaryStorageMode,
    type CloudProvider,
    type MediaStorageMode,
    type ProductMediaStorageMode,
} from '../models/MediaReference.model';

const DEFAULT_MONGODB_URI = 'mongodb://localhost:27017/aitest';

type BackfillStorageMode = MediaStorageMode;
type BackfillPrimaryStorageMode = ProductMediaStorageMode;

export interface MediaReferenceCatalogBackfillSummary {
    collectionFound: boolean;
    scanned: number;
    updated: number;
    alreadyCompatible: number;
    blocked: number;
    indexesEnsured: number;
}

function trimToNull(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeStorageMode(value: unknown): BackfillStorageMode | undefined {
    return value === 'db' || value === 'local' || value === 'cloud' ? value : undefined;
}

function toIdString(value: unknown): string | undefined {
    if (value instanceof mongoose.Types.ObjectId) {
        return value.toString();
    }

    if (typeof value === 'string' && value.trim()) {
        return value;
    }

    if (value && typeof value === 'object' && 'toString' in (value as Record<string, unknown>)) {
        const stringValue = String(value);
        return stringValue && stringValue !== '[object Object]' ? stringValue : undefined;
    }

    return undefined;
}


function buildBackfillUpdate(
    doc: Record<string, unknown>,
    journalMetadataById: Map<string, { cloudConnectionProfileId?: string }>,
) {
    const storageMode = normalizeStorageMode(doc.storageMode);
    if (!storageMode) {
        return { blocked: true as const, update: null };
    }

    const $set: Record<string, unknown> = {};
    const $unset: Record<string, ''> = {};
    const derivedPrimaryStorageMode = deriveMediaReferencePrimaryStorageMode(storageMode);
    const derivedCanonicalLocator = buildMediaReferenceCanonicalLocator({
        storageMode,
        localPath: typeof doc.localPath === 'string' ? doc.localPath : undefined,
        gridfsId: toIdString(doc.gridfsId),
        journalEntryId: toIdString(doc.journalEntryId),
        cloudKey: typeof doc.cloudKey === 'string' ? doc.cloudKey : undefined,
        cloudProvider: doc.cloudProvider === 's3' || doc.cloudProvider === 'gcs'
            ? doc.cloudProvider as CloudProvider
            : undefined,
        cloudBucket: typeof doc.cloudBucket === 'string' ? doc.cloudBucket : undefined,
    });
    const agentInstanceId = doc.agentInstanceId;
    const generatedBy = typeof doc.generatedBy === 'string' && doc.generatedBy.trim() ? doc.generatedBy : undefined;
    const journalEntryId = toIdString(doc.journalEntryId);
    const journalMetadata = journalEntryId ? journalMetadataById.get(journalEntryId) : undefined;

    if (doc.primaryStorageMode !== derivedPrimaryStorageMode) {
        $set.primaryStorageMode = derivedPrimaryStorageMode;
    }

    if (!derivedCanonicalLocator) {
        return { blocked: true as const, update: null };
    }

    if (doc.canonicalLocator !== derivedCanonicalLocator) {
        $set.canonicalLocator = derivedCanonicalLocator;
    }

    if (!doc.createdByAgentInstanceId && agentInstanceId) {
        $set.createdByAgentInstanceId = agentInstanceId;
    }

    if (!doc.lastModifiedByAgentInstanceId && (doc.createdByAgentInstanceId || agentInstanceId)) {
        $set.lastModifiedByAgentInstanceId = doc.createdByAgentInstanceId || agentInstanceId;
    }

    if (!doc.createdByAgentName && generatedBy) {
        $set.createdByAgentName = generatedBy;
    }

    if (!doc.lastModifiedByAgentName) {
        const fallbackName = (typeof doc.createdByAgentName === 'string' && doc.createdByAgentName.trim())
            ? doc.createdByAgentName
            : generatedBy;
        if (fallbackName) {
            $set.lastModifiedByAgentName = fallbackName;
        }
    }

    if (storageMode === 'cloud') {
        const existingCloudConnectionProfileId = trimToNull(doc.cloudConnectionProfileId);
        const repairedCloudConnectionProfileId = journalMetadata?.cloudConnectionProfileId;

        if (!existingCloudConnectionProfileId && repairedCloudConnectionProfileId) {
            $set.cloudConnectionProfileId = repairedCloudConnectionProfileId;
        }
    }

    if (typeof doc.isOrphan !== 'boolean') {
        $set.isOrphan = false;
    }

    const effectiveIsOrphan = typeof doc.isOrphan === 'boolean' ? doc.isOrphan : false;
    if (!effectiveIsOrphan) {
        if (doc.orphanedAt !== undefined) {
            $unset.orphanedAt = '';
        }
        if (doc.orphanReason !== undefined) {
            $unset.orphanReason = '';
        }
    }

    if (Object.keys($set).length === 0 && Object.keys($unset).length === 0) {
        return { blocked: false as const, update: null };
    }

    return {
        blocked: false as const,
        update: {
            ...(Object.keys($set).length > 0 ? { $set } : {}),
            ...(Object.keys($unset).length > 0 ? { $unset } : {}),
        },
    };
}

export async function backfillMediaReferenceCatalogFields(db: any): Promise<MediaReferenceCatalogBackfillSummary> {
    const collections = await db.listCollections({ name: 'media_references' }).toArray();
    if (collections.length === 0) {
        return {
            collectionFound: false,
            scanned: 0,
            updated: 0,
            alreadyCompatible: 0,
            blocked: 0,
            indexesEnsured: 0,
        };
    }

    const mediaCollection = db.collection('media_references');
    const mediaReferences = await mediaCollection.find({}).toArray();
    const journalMetadataById = await loadCloudJournalMetadataById(
        db,
        (mediaReferences as Array<Record<string, unknown>>)
            .filter((mediaReference) => mediaReference.storageMode === 'cloud')
            .map((mediaReference) => toIdString(mediaReference.journalEntryId))
            .filter((value): value is string => Boolean(value)),
    );

    let updated = 0;
    let alreadyCompatible = 0;
    let blocked = 0;

    for (const mediaReference of mediaReferences as Array<Record<string, unknown>>) {
        const result = buildBackfillUpdate(mediaReference, journalMetadataById);

        if (result.blocked) {
            blocked++;
            continue;
        }

        if (!result.update) {
            alreadyCompatible++;
            continue;
        }

        await mediaCollection.updateOne({ _id: mediaReference._id }, result.update);
        updated++;
    }

    const indexes = [
        { keys: { userId: 1, workflowId: 1 } },
        { keys: { userId: 1, createdAt: -1 } },
        { keys: { agentInstanceId: 1, createdAt: -1 } },
        { keys: { workflowId: 1, storageMode: 1 } },
        { keys: { workflowId: 1, primaryStorageMode: 1, isOrphan: 1, updatedAt: -1 } },
        { keys: { workflowId: 1, createdByAgentInstanceId: 1, updatedAt: -1 } },
        {
            keys: { userId: 1, workflowId: 1, canonicalLocator: 1 },
            options: {
                unique: true,
                partialFilterExpression: { canonicalLocator: { $exists: true } },
                name: 'uq_media_reference_user_workflow_locator',
            },
        },
        {
            keys: { userId: 1, workflowId: 1, journalEntryId: 1 },
            options: {
                unique: true,
                partialFilterExpression: { journalEntryId: { $exists: true } },
                name: 'uq_media_reference_user_workflow_journal',
            },
        },
        { keys: { storageMode: 1, createdAt: 1 } },
    ];

    let indexesEnsured = 0;
    for (const index of indexes) {
        await mediaCollection.createIndex(index.keys, index.options ?? {});
        indexesEnsured++;
    }

    return {
        collectionFound: true,
        scanned: mediaReferences.length,
        updated,
        alreadyCompatible,
        blocked,
        indexesEnsured,
    };
}

async function runUp(): Promise<void> {
    const mongoUri = process.env.MONGODB_URI || DEFAULT_MONGODB_URI;
    await mongoose.connect(mongoUri);

    try {
        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('MongoDB database handle unavailable');
        }

        const summary = await backfillMediaReferenceCatalogFields(db);
        console.log(
            `[Migration 006] media_references backfill: found=${summary.collectionFound} scanned=${summary.scanned} updated=${summary.updated} compatible=${summary.alreadyCompatible} blocked=${summary.blocked} indexes=${summary.indexesEnsured}`
        );
    } finally {
        await mongoose.connection.close();
    }
}

const direction = process.argv[2] || 'up';
const isDirectCliInvocation = /(^|[\\/])006_media_reference_catalog_backfill\.(ts|js)$/.test(process.argv[1] ?? '');

if (isDirectCliInvocation) {
    if (direction !== 'up') {
        console.error(`[Migration 006] Direction non supportee: ${direction}. Seule la migration 'up' est autorisee.`);
        process.exit(1);
    }

    runUp().catch((err) => {
        console.error('[Migration 006] ERREUR:', err instanceof Error ? err.message : String(err));
        process.exit(1);
    });
}

async function loadCloudJournalMetadataById(
    db: any,
    journalEntryIds: string[],
): Promise<Map<string, { cloudConnectionProfileId?: string }>> {
    if (journalEntryIds.length === 0) {
        return new Map();
    }

    const collections = await db.listCollections({ name: 'agent_journals' }).toArray();
    if (collections.length === 0) {
        return new Map();
    }

    const journalCollection = db.collection('agent_journals');
    const objectIds = journalEntryIds
        .filter((journalEntryId) => mongoose.Types.ObjectId.isValid(journalEntryId))
        .map((journalEntryId) => new mongoose.Types.ObjectId(journalEntryId));

    if (objectIds.length === 0) {
        return new Map();
    }

    const journals = await journalCollection.find({
        _id: { $in: objectIds },
        type: 'media',
    }).toArray();

    const journalMetadataById = new Map<string, { cloudConnectionProfileId?: string }>();

    for (const journal of journals as Array<Record<string, unknown>>) {
        const journalId = toIdString(journal._id);
        const payload = journal.payload as Record<string, unknown> | undefined;
        const metadata = payload?.metadata as Record<string, unknown> | undefined;
        const cloudConnectionProfileId = trimToNull(metadata?.cloudConnectionProfileId);

        if (!journalId || !cloudConnectionProfileId) {
            continue;
        }

        journalMetadataById.set(journalId, { cloudConnectionProfileId });
    }

    return journalMetadataById;
}
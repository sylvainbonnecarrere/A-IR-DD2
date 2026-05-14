import mongoose from 'mongoose';

const DEFAULT_MONGODB_URI = 'mongodb://localhost:27017/aitest';

type BackfillStorageMode = 'db' | 'local' | 'cloud';
type BackfillPrimaryStorageMode = 'db' | 'workspace' | 'cloud';

export interface MediaReferenceCatalogBackfillSummary {
    collectionFound: boolean;
    scanned: number;
    updated: number;
    alreadyCompatible: number;
    blocked: number;
    indexesEnsured: number;
}

function normalizeStorageMode(value: unknown): BackfillStorageMode | undefined {
    return value === 'db' || value === 'local' || value === 'cloud' ? value : undefined;
}

function derivePrimaryStorageMode(storageMode: BackfillStorageMode): BackfillPrimaryStorageMode {
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

function buildCanonicalLocator(doc: Record<string, unknown>, storageMode: BackfillStorageMode): string | undefined {
    switch (storageMode) {
        case 'local': {
            const localPath = typeof doc.localPath === 'string' ? doc.localPath : undefined;
            return localPath ? `workspace://${localPath}` : undefined;
        }
        case 'db': {
            const gridfsId = toIdString(doc.gridfsId);
            if (gridfsId) {
                return `gridfs://${gridfsId}`;
            }

            const journalEntryId = toIdString(doc.journalEntryId);
            return journalEntryId ? `journal://${journalEntryId}` : undefined;
        }
        case 'cloud': {
            const cloudKey = typeof doc.cloudKey === 'string' ? doc.cloudKey : undefined;
            if (!cloudKey) {
                return undefined;
            }

            const cloudProvider = doc.cloudProvider === 's3' || doc.cloudProvider === 'gcs'
                ? doc.cloudProvider
                : undefined;
            const cloudBucket = typeof doc.cloudBucket === 'string' ? doc.cloudBucket : undefined;

            if (cloudProvider && cloudBucket) {
                return `${cloudProvider}://${cloudBucket}/${cloudKey}`;
            }

            return `cloud://${cloudKey}`;
        }
        default:
            return undefined;
    }
}

function buildBackfillUpdate(doc: Record<string, unknown>) {
    const storageMode = normalizeStorageMode(doc.storageMode);
    if (!storageMode) {
        return { blocked: true as const, update: null };
    }

    const $set: Record<string, unknown> = {};
    const $unset: Record<string, ''> = {};
    const derivedPrimaryStorageMode = derivePrimaryStorageMode(storageMode);
    const derivedCanonicalLocator = buildCanonicalLocator(doc, storageMode);
    const agentInstanceId = doc.agentInstanceId;
    const generatedBy = typeof doc.generatedBy === 'string' && doc.generatedBy.trim() ? doc.generatedBy : undefined;

    if (!doc.primaryStorageMode) {
        $set.primaryStorageMode = derivedPrimaryStorageMode;
    }

    if (!doc.canonicalLocator) {
        if (!derivedCanonicalLocator) {
            return { blocked: true as const, update: null };
        }
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

    let updated = 0;
    let alreadyCompatible = 0;
    let blocked = 0;

    for (const mediaReference of mediaReferences as Array<Record<string, unknown>>) {
        const result = buildBackfillUpdate(mediaReference);

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
        { userId: 1, workflowId: 1 },
        { userId: 1, createdAt: -1 },
        { agentInstanceId: 1, createdAt: -1 },
        { workflowId: 1, storageMode: 1 },
        { workflowId: 1, primaryStorageMode: 1, isOrphan: 1, updatedAt: -1 },
        { workflowId: 1, createdByAgentInstanceId: 1, updatedAt: -1 },
        { storageMode: 1, createdAt: 1 },
    ];

    let indexesEnsured = 0;
    for (const index of indexes) {
        await mediaCollection.createIndex(index);
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
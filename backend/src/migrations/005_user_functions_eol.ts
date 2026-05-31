import mongoose from 'mongoose';
import type { LegacyFunctionLike } from '../utils/userToolLegacyMapper';
import { mapLegacyFunctionToUserToolFields } from '../utils/userToolLegacyMapper';

const DEFAULT_MONGODB_URI = 'mongodb://localhost:27017/aitest';

export interface UserFunctionsEolSummary {
    collectionFound: boolean;
    scanned: number;
    created: number;
    skippedExistingById: number;
    blockedByLogicalConflict: number;
    dropped: boolean;
}

function buildCanonicalIdentityFilter(legacy: LegacyFunctionLike): Record<string, unknown> {
    if (legacy.origin === 'native') {
        return {
            scopeType: 'native',
            ownerUserId: null,
            name: legacy.name,
        };
    }

    return {
        scopeType: 'user',
        ownerUserId: legacy.userId ?? null,
        workflowId: legacy.workflowId ?? null,
        name: legacy.name,
    };
}

function normalizeLegacyId(id: LegacyFunctionLike['_id']): mongoose.Types.ObjectId {
    if (id instanceof mongoose.Types.ObjectId) {
        return id;
    }

    if (id) {
        return new mongoose.Types.ObjectId(String(id));
    }

    return new mongoose.Types.ObjectId();
}

function normalizeDate(value: unknown): Date {
    if (value instanceof Date) {
        return value;
    }

    if (typeof value === 'string' || typeof value === 'number') {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed;
        }
    }

    return new Date();
}

export async function migrateLegacyUserFunctionsToUserToolsAndDropCollection(db: any): Promise<UserFunctionsEolSummary> {
    const collections = await db.listCollections({ name: 'user_functions' }).toArray();
    if (collections.length === 0) {
        return {
            collectionFound: false,
            scanned: 0,
            created: 0,
            skippedExistingById: 0,
            blockedByLogicalConflict: 0,
            dropped: false,
        };
    }

    const legacyFunctionsCol = db.collection('user_functions');
    const userToolsCol = db.collection('user_tools');
    const legacyFunctions = await legacyFunctionsCol.find({}).toArray();

    if (legacyFunctions.length === 0) {
        await db.dropCollection('user_functions');
        return {
            collectionFound: true,
            scanned: 0,
            created: 0,
            skippedExistingById: 0,
            blockedByLogicalConflict: 0,
            dropped: true,
        };
    }

    let created = 0;
    let skippedExistingById = 0;
    let blockedByLogicalConflict = 0;

    for (const legacyFunction of legacyFunctions as LegacyFunctionLike[]) {
        const legacyId = normalizeLegacyId(legacyFunction._id);
        const existingById = await userToolsCol.findOne(
            { _id: legacyId },
            { projection: { _id: 1 } },
        );

        if (existingById) {
            skippedExistingById++;
            continue;
        }

        const logicalConflict = await userToolsCol.findOne(
            buildCanonicalIdentityFilter(legacyFunction),
            { projection: { _id: 1 } },
        );

        if (logicalConflict) {
            blockedByLogicalConflict++;
            continue;
        }

        await userToolsCol.insertOne({
            _id: legacyId,
            ...mapLegacyFunctionToUserToolFields(legacyFunction),
            createdAt: normalizeDate(legacyFunction.createdAt),
            updatedAt: normalizeDate(legacyFunction.updatedAt),
        });
        created++;
    }

    const dropped = blockedByLogicalConflict === 0;
    if (dropped) {
        await db.dropCollection('user_functions');
    }

    return {
        collectionFound: true,
        scanned: legacyFunctions.length,
        created,
        skippedExistingById,
        blockedByLogicalConflict,
        dropped,
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

        const summary = await migrateLegacyUserFunctionsToUserToolsAndDropCollection(db);

        console.log(
            `[Migration 005] user_functions EOL: found=${summary.collectionFound} scanned=${summary.scanned} created=${summary.created} skippedExistingById=${summary.skippedExistingById} blocked=${summary.blockedByLogicalConflict} dropped=${summary.dropped}`
        );

        if (summary.blockedByLogicalConflict > 0) {
            throw new Error(
                `[Migration 005] ${summary.blockedByLogicalConflict} conflit(s) logique(s) detecte(s); drop annule jusqu'a resolution explicite`
            );
        }
    } finally {
        await mongoose.connection.close();
    }
}

const direction = process.argv[2] || 'up';
const isDirectCliInvocation = /(^|[\\/])005_user_functions_eol\.(ts|js)$/.test(process.argv[1] ?? '');

if (isDirectCliInvocation) {
    if (direction !== 'up') {
        console.error(`[Migration 005] Direction non supportee: ${direction}. Seule la migration 'up' est autorisee.`);
        process.exit(1);
    }

    runUp().catch((err) => {
        console.error('[Migration 005] ERREUR:', err instanceof Error ? err.message : String(err));
        process.exit(1);
    });
}
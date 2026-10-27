import mongoose from 'mongoose';

const DEFAULT_MONGODB_URI = 'mongodb://localhost:27017/aitest';

type CollectionName = 'workflows' | 'workflow_nodes_v2' | 'workflow_edges' | 'agent_instances';

interface IndexDefinition {
    keys: Record<string, 1 | -1>;
    options: { name: string; unique?: boolean; partialFilterExpression?: Record<string, unknown> };
}

export interface SecurityOwnershipIndexesSummary {
    collectionsFound: number;
    indexesCreated: number;
    indexesSkipped: number;
}

const SECURITY_INDEXES: Record<CollectionName, IndexDefinition[]> = {
    workflows: [
        {
            keys: { userId: 1, isDefault: 1 },
            options: {
                name: 'uq_workflows_default_per_user',
                unique: true,
                partialFilterExpression: { isDefault: true },
            },
        },
    ],
    workflow_nodes_v2: [
        {
            keys: { ownerId: 1, workflowId: 1 },
            options: { name: 'idx_workflow_nodes_v2_owner_workflow' },
        },
    ],
    workflow_edges: [
        {
            keys: { userId: 1, workflowId: 1, updatedAt: -1 },
            options: { name: 'idx_workflow_edges_owner_workflow_updated' },
        },
    ],
    agent_instances: [
        {
            keys: { userId: 1, workflowId: 1, status: 1 },
            options: { name: 'idx_agent_instances_owner_workflow_status' },
        },
    ],
};

async function ensureCollectionIndexes(
    db: any,
    collectionName: CollectionName,
    definitions: IndexDefinition[],
): Promise<{ created: number; skipped: number; found: boolean }> {
    const collections = await db.listCollections({ name: collectionName }).toArray();
    if (collections.length === 0) {
        return { created: 0, skipped: 0, found: false };
    }

    const collection = db.collection(collectionName);
    const existingIndexes = await collection.listIndexes().toArray();
    const existingNames = new Set(existingIndexes.map((index: { name?: string }) => index.name).filter(Boolean));

    let created = 0;
    let skipped = 0;

    for (const definition of definitions) {
        if (existingNames.has(definition.options.name)) {
            skipped++;
            continue;
        }

        await collection.createIndex(definition.keys, definition.options);
        existingNames.add(definition.options.name);
        created++;
    }

    return { created, skipped, found: true };
}

export async function ensureSecurityOwnershipIndexes(db: any): Promise<SecurityOwnershipIndexesSummary> {
    let collectionsFound = 0;
    let indexesCreated = 0;
    let indexesSkipped = 0;

    for (const [collectionName, definitions] of Object.entries(SECURITY_INDEXES) as Array<[CollectionName, IndexDefinition[]]>) {
        const result = await ensureCollectionIndexes(db, collectionName, definitions);
        if (result.found) {
            collectionsFound++;
        }
        indexesCreated += result.created;
        indexesSkipped += result.skipped;
    }

    return {
        collectionsFound,
        indexesCreated,
        indexesSkipped,
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

        const summary = await ensureSecurityOwnershipIndexes(db);
        console.log(
            `[Migration 007] security ownership indexes: collections=${summary.collectionsFound} created=${summary.indexesCreated} skipped=${summary.indexesSkipped}`
        );
    } finally {
        await mongoose.connection.close();
    }
}

const direction = process.argv[2] || 'up';
const isDirectCliInvocation = /(^|[\\/])007_security_ownership_indexes\.(ts|js)$/.test(process.argv[1] ?? '');

if (isDirectCliInvocation) {
    if (direction !== 'up') {
        console.error(`[Migration 007] Direction non supportee: ${direction}. Seule la migration 'up' est autorisee.`);
        process.exit(1);
    }

    runUp().catch((err) => {
        console.error('[Migration 007] ERREUR:', err instanceof Error ? err.message : String(err));
        process.exit(1);
    });
}
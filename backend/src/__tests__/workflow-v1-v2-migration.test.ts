import mongoose from 'mongoose';
import {
    migrateLegacyWorkflowGraphsToV2,
    type WorkflowV1ToV2MigrationSummary,
} from '../migrations/008_workflow_v1_to_v2_migration';

class FakeCollection {
    private readonly docs: any[];

    constructor(initialDocs: any[] = []) {
        this.docs = initialDocs.map((doc) => this.clone(doc));
    }

    find(filter: Record<string, any> = {}) {
        const filtered = this.docs.filter((doc) => this.matches(doc, filter));
        return {
            toArray: async () => filtered.map((doc) => this.clone(doc)),
        };
    }

    async findOne(filter: Record<string, any> = {}) {
        const match = this.docs.find((doc) => this.matches(doc, filter));
        return match ? this.clone(match) : null;
    }

    async insertOne(doc: Record<string, any>) {
        this.docs.push(this.clone(doc));
        return { acknowledged: true, insertedId: doc._id ?? new mongoose.Types.ObjectId() };
    }

    async updateOne(filter: Record<string, any>, update: Record<string, any>) {
        const index = this.docs.findIndex((doc) => this.matches(doc, filter));
        if (index === -1) {
            this.docs.push(this.clone(update.$set ?? {}));
            return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
        }

        const current = this.docs[index];
        const merged = { ...this.clone(current), ...(update.$set ?? {}) };
        this.docs[index] = merged;
        return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
    }

    snapshot() {
        return this.docs.map((doc) => this.clone(doc));
    }

    private matches(doc: Record<string, any>, filter: Record<string, any>): boolean {
        return Object.entries(filter).every(([key, value]) => {
            if (key === '$or') {
                return (value as any[]).some((subFilter) => this.matches(doc, subFilter));
            }

            if (typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)) {
                if ('$ne' in value) {
                    return this.getValue(doc, key) !== value.$ne;
                }
                if ('$exists' in value) {
                    return value.$exists ? key in doc : !(key in doc);
                }
                if ('$in' in value) {
                    const actual = this.getValue(doc, key);
                    return (value.$in as any[]).includes(actual);
                }
            }

            return this.getValue(doc, key) === this.normalizeValue(value);
        });
    }

    private getValue(doc: Record<string, any>, key: string): any {
        return key.split('.').reduce((current, part) => current?.[part], doc);
    }

    private normalizeValue(value: any): any {
        if (value instanceof mongoose.Types.ObjectId) {
            return value.toString();
        }

        if (Array.isArray(value)) {
            return value.map((item) => this.normalizeValue(item));
        }

        if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
            return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.normalizeValue(v)]));
        }

        return value ?? null;
    }

    private clone<T>(value: T): T {
        return JSON.parse(JSON.stringify(value));
    }
}

class FakeDb {
    private readonly collections: Record<string, FakeCollection>;
    private readonly dropped: Set<string> = new Set();

    constructor(collections: Record<string, FakeCollection>) {
        this.collections = collections;
    }

    listCollections(filter?: { name?: string }) {
        return {
            toArray: async () => Object.keys(this.collections)
                .filter((name) => !this.dropped.has(name))
                .filter((name) => !filter?.name || name === filter.name)
                .map((name) => ({ name })),
        };
    }

    collection(name: string) {
        const collection = this.collections[name];
        if (!collection) {
            throw new Error(`Unknown fake collection: ${name}`);
        }
        return collection;
    }

    async dropCollection(name: string) {
        if (!this.collections[name]) {
            throw new Error(`Unknown fake collection: ${name}`);
        }
        this.dropped.add(name);
    }
}

describe('workflow V1 -> V2 migration', () => {
    it('creates V2 node and edge records from a legacy workflow graph and records a migration checkpoint', async () => {
        const workflowId = new mongoose.Types.ObjectId();
        const userId = new mongoose.Types.ObjectId();
        const instanceA = new mongoose.Types.ObjectId();
        const instanceB = new mongoose.Types.ObjectId();

        const db = new FakeDb({
            workflows: new FakeCollection([
                {
                    _id: workflowId,
                    userId,
                    name: 'Legacy workflow',
                    nodes: [
                        {
                            _id: new mongoose.Types.ObjectId(),
                            id: 'node-a',
                            instanceId: instanceA,
                            nodeType: 'agent',
                            position: { x: 10, y: 20 },
                            data: { label: 'Alpha' },
                            createdAt: new Date('2026-01-01T00:00:00Z'),
                            updatedAt: new Date('2026-01-01T00:00:00Z'),
                        },
                        {
                            _id: new mongoose.Types.ObjectId(),
                            id: 'node-b',
                            instanceId: instanceB,
                            nodeType: 'agent',
                            position: { x: 30, y: 40 },
                            data: { label: 'Bravo' },
                            createdAt: new Date('2026-01-01T00:00:00Z'),
                            updatedAt: new Date('2026-01-01T00:00:00Z'),
                        },
                    ],
                    edges: [
                        {
                            _id: new mongoose.Types.ObjectId(),
                            id: 'edge-1',
                            source: instanceA.toString(),
                            target: instanceB.toString(),
                            type: 'smoothstep',
                            label: 'primary',
                            createdAt: new Date('2026-01-01T00:00:00Z'),
                            updatedAt: new Date('2026-01-01T00:00:00Z'),
                        },
                    ],
                },
            ]),
            workflow_nodes_v2: new FakeCollection([]),
            workflow_edges: new FakeCollection([]),
            workflow_migrations: new FakeCollection([]),
            schema_migrations: new FakeCollection([]),
        });

        const summary: WorkflowV1ToV2MigrationSummary = await migrateLegacyWorkflowGraphsToV2(db as any);

        expect(summary.workflowsScanned).toBe(1);
        expect(summary.workflowsMigrated).toBe(1);
        expect(summary.nodesCreated).toBe(2);
        expect(summary.edgesCreated).toBe(1);
        expect(summary.duplicatesPrevented).toBe(0);

        const nodeDocs = db.collection('workflow_nodes_v2').snapshot();
        const edgeDocs = db.collection('workflow_edges').snapshot();
        const checkpoint = db.collection('workflow_migrations').snapshot();

        expect(nodeDocs).toHaveLength(2);
        expect(edgeDocs).toHaveLength(1);
        expect(edgeDocs[0]).toEqual(expect.objectContaining({
            workflowId: workflowId.toString(),
            sourceInstanceId: instanceA.toString(),
            targetInstanceId: instanceB.toString(),
        }));
        expect(checkpoint).toEqual(expect.arrayContaining([
            expect.objectContaining({
                workflowId: workflowId.toString(),
                sourceVersion: 'v1',
                targetVersion: 'v2',
                status: 'completed',
            }),
        ]));
    });

    it('is idempotent when the V1 workflow has already been migrated', async () => {
        const workflowId = new mongoose.Types.ObjectId();
        const userId = new mongoose.Types.ObjectId();
        const instanceA = new mongoose.Types.ObjectId();
        const instanceB = new mongoose.Types.ObjectId();

        const db = new FakeDb({
            workflows: new FakeCollection([
                {
                    _id: workflowId,
                    userId,
                    name: 'Legacy workflow',
                    nodes: [
                        {
                            _id: new mongoose.Types.ObjectId(),
                            id: 'node-a',
                            instanceId: instanceA,
                            nodeType: 'agent',
                            position: { x: 10, y: 20 },
                            data: { label: 'Alpha' },
                        },
                        {
                            _id: new mongoose.Types.ObjectId(),
                            id: 'node-b',
                            instanceId: instanceB,
                            nodeType: 'agent',
                            position: { x: 30, y: 40 },
                            data: { label: 'Bravo' },
                        },
                    ],
                    edges: [
                        {
                            _id: new mongoose.Types.ObjectId(),
                            id: 'edge-1',
                            source: instanceA.toString(),
                            target: instanceB.toString(),
                            type: 'smoothstep',
                        },
                    ],
                },
            ]),
            workflow_nodes_v2: new FakeCollection([
                {
                    _id: new mongoose.Types.ObjectId(),
                    workflowId: workflowId.toString(),
                    ownerId: userId.toString(),
                    nodeType: 'agent',
                    instanceId: instanceA,
                    position: { x: 10, y: 20 },
                    uiConfig: { label: 'Alpha' },
                    nodeData: { label: 'Alpha' },
                    metadata: { legacyNodeId: 'node-a' },
                },
                {
                    _id: new mongoose.Types.ObjectId(),
                    workflowId: workflowId.toString(),
                    ownerId: userId.toString(),
                    nodeType: 'agent',
                    instanceId: instanceB,
                    position: { x: 30, y: 40 },
                    uiConfig: { label: 'Bravo' },
                    nodeData: { label: 'Bravo' },
                    metadata: { legacyNodeId: 'node-b' },
                },
            ]),
            workflow_edges: new FakeCollection([
                {
                    _id: new mongoose.Types.ObjectId(),
                    workflowId: workflowId.toString(),
                    userId: userId.toString(),
                    sourceInstanceId: instanceA,
                    targetInstanceId: instanceB,
                    edgeType: 'smoothstep',
                    animated: false,
                    label: 'primary',
                },
            ]),
            workflow_migrations: new FakeCollection([
                {
                    _id: new mongoose.Types.ObjectId(),
                    workflowId: workflowId.toString(),
                    sourceVersion: 'v1',
                    targetVersion: 'v2',
                    status: 'completed',
                    migratedAt: new Date('2026-01-02T00:00:00Z'),
                },
            ]),
            schema_migrations: new FakeCollection([]),
        });

        const summary = await migrateLegacyWorkflowGraphsToV2(db as any);

        expect(summary.workflowsScanned).toBe(1);
        expect(summary.workflowsMigrated).toBe(0);
        expect(summary.nodesCreated).toBe(0);
        expect(summary.edgesCreated).toBe(0);
        expect(summary.duplicatesPrevented).toBe(2);
    });
});

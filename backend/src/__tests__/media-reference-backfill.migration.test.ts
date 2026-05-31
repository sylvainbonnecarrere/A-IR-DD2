import mongoose from 'mongoose';
import { backfillMediaReferenceCatalogFields } from '../migrations/006_media_reference_catalog_backfill';

class FakeCollection {
    private readonly docs = new Map<string, any>();
    private readonly indexes: Array<{ keys: Record<string, number>; options: Record<string, any> }> = [];

    constructor(initialDocs: any[] = []) {
        initialDocs.forEach((doc) => {
            this.docs.set(this.getKey(doc._id), this.clone(doc));
        });
    }

    find(filter: Record<string, any> = {}) {
        return {
            toArray: async () => Array.from(this.docs.values())
                .filter((doc) => this.matches(doc, filter))
                .map((doc) => this.clone(doc)),
        };
    }

    async updateOne(filter: Record<string, unknown>, update: Record<string, any>) {
        const match = Array.from(this.docs.values()).find((doc) => this.matches(doc, filter));
        if (!match) {
            return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
        }

        if (update.$set) {
            Object.assign(match, this.clone(update.$set));
        }
        if (update.$unset) {
            Object.keys(update.$unset).forEach((field) => {
                delete match[field];
            });
        }

        this.docs.set(this.getKey(match._id), this.clone(match));
        return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
    }

    async createIndex(index: Record<string, number>, options: Record<string, any> = {}) {
        this.indexes.push({
            keys: this.clone(index),
            options: this.clone(options),
        });
        return `idx_${this.indexes.length}`;
    }

    snapshot(): any[] {
        return Array.from(this.docs.values()).map((doc) => this.clone(doc));
    }

    indexSnapshot(): Array<{ keys: Record<string, number>; options: Record<string, any> }> {
        return this.indexes.map((index) => this.clone(index));
    }

    private matches(doc: Record<string, any>, filter: Record<string, unknown>): boolean {
        return Object.entries(filter).every(([key, value]) => {
            const docValue = doc[key];

            if (value && typeof value === 'object' && !Array.isArray(value) && '$in' in (value as Record<string, unknown>)) {
                const candidates = ((value as Record<string, unknown>).$in as unknown[]) || [];
                return candidates.some((candidate) => this.toComparable(candidate) === this.toComparable(docValue));
            }

            return this.toComparable(docValue) === this.toComparable(value);
        });
    }

    private toComparable(value: unknown): unknown {
        if (value instanceof mongoose.Types.ObjectId) {
            return value.toString();
        }

        return value ?? null;
    }

    private getKey(id: unknown): string {
        return String(this.toComparable(id));
    }

    private clone<T>(value: T): T {
        if (value === undefined || value === null) {
            return value;
        }

        return JSON.parse(JSON.stringify(value));
    }
}

class FakeDb {
    private readonly collections: Record<string, FakeCollection>;

    constructor(collections: Record<string, FakeCollection>) {
        this.collections = collections;
    }

    listCollections(filter?: { name?: string }) {
        return {
            toArray: async () => Object.keys(this.collections)
                .filter((name) => !filter?.name || name === filter.name)
                .map((name) => ({ name })),
        };
    }

    collection(name: string): FakeCollection {
        const collection = this.collections[name];
        if (!collection) {
            throw new Error(`Unknown fake collection: ${name}`);
        }

        return collection;
    }
}

describe('media_references catalog backfill migration', () => {
    it('backfills additive catalog fields for legacy db, workspace, and cloud documents and ensures indexes', async () => {
        const agentInstanceId = new mongoose.Types.ObjectId();
        const journalEntryId = new mongoose.Types.ObjectId();
        const cloudJournalEntryId = new mongoose.Types.ObjectId();
        const workflowId = new mongoose.Types.ObjectId();
        const userId = new mongoose.Types.ObjectId();

        const dbMedia = {
            _id: new mongoose.Types.ObjectId(),
            userId,
            workflowId,
            agentInstanceId,
            journalEntryId,
            storageMode: 'db',
            fileName: 'artifact.txt',
            originalName: 'artifact.txt',
            mimeType: 'text/plain',
            size: 42,
            generatedBy: 'Legacy DB Agent',
        };

        const workspaceMedia = {
            _id: new mongoose.Types.ObjectId(),
            userId,
            workflowId,
            agentInstanceId,
            storageMode: 'local',
            primaryStorageMode: 'db',
            canonicalLocator: 'journal://stale-workspace-locator',
            localPath: 'users/u1/workflows/w1/agents/a1/2026-05/workspace-note.txt',
            fileName: 'workspace-note.txt',
            originalName: 'workspace-note.txt',
            mimeType: 'text/plain',
            size: 21,
            generatedBy: 'Legacy Workspace Agent',
            orphanedAt: '2026-05-10T10:00:00.000Z',
            orphanReason: 'unknown',
        };

        const alreadyCompatible = {
            _id: new mongoose.Types.ObjectId(),
            userId,
            workflowId,
            agentInstanceId,
            storageMode: 'local',
            primaryStorageMode: 'workspace',
            canonicalLocator: 'workspace://users/u1/workflows/w1/agents/a1/2026-05/already.txt',
            localPath: 'users/u1/workflows/w1/agents/a1/2026-05/already.txt',
            fileName: 'already.txt',
            originalName: 'already.txt',
            mimeType: 'text/plain',
            size: 10,
            createdByAgentInstanceId: agentInstanceId,
            lastModifiedByAgentInstanceId: agentInstanceId,
            createdByAgentName: 'Already Good',
            lastModifiedByAgentName: 'Already Good',
            isOrphan: false,
        };

        const cloudMedia = {
            _id: new mongoose.Types.ObjectId(),
            userId,
            workflowId,
            agentInstanceId,
            journalEntryId: cloudJournalEntryId,
            storageMode: 'cloud',
            canonicalLocator: 's3://media-bucket/tenant/cloud-artifact.txt',
            cloudKey: 'tenant/cloud-artifact.txt',
            cloudProvider: 's3',
            cloudBucket: 'media-bucket',
            fileName: 'cloud-artifact.txt',
            originalName: 'cloud-artifact.txt',
            mimeType: 'text/plain',
            size: 18,
            generatedBy: 'Legacy Cloud Agent',
        };

        const agentJournalCollection = new FakeCollection([
            {
                _id: cloudJournalEntryId,
                type: 'media',
                payload: {
                    metadata: {
                        cloudConnectionProfileId: 'cloud-profile-legacy-1',
                    },
                },
            },
        ]);

        const mediaCollection = new FakeCollection([dbMedia, workspaceMedia, alreadyCompatible, cloudMedia]);
        const db = new FakeDb({ media_references: mediaCollection, agent_journals: agentJournalCollection });

        const summary = await backfillMediaReferenceCatalogFields(db as any);
        const snapshot = mediaCollection.snapshot();

        expect(summary).toEqual({
            collectionFound: true,
            scanned: 4,
            updated: 3,
            alreadyCompatible: 1,
            blocked: 0,
            indexesEnsured: 9,
        });

        const migratedDbMedia = snapshot.find((doc) => doc.fileName === 'artifact.txt');
        expect(migratedDbMedia).toEqual(expect.objectContaining({
            primaryStorageMode: 'db',
            canonicalLocator: `journal://${journalEntryId.toString()}`,
            createdByAgentInstanceId: agentInstanceId.toString(),
            lastModifiedByAgentInstanceId: agentInstanceId.toString(),
            createdByAgentName: 'Legacy DB Agent',
            lastModifiedByAgentName: 'Legacy DB Agent',
            isOrphan: false,
        }));

        const migratedWorkspaceMedia = snapshot.find((doc) => doc.fileName === 'workspace-note.txt');
        expect(migratedWorkspaceMedia).toEqual(expect.objectContaining({
            primaryStorageMode: 'workspace',
            canonicalLocator: 'workspace://users/u1/workflows/w1/agents/a1/2026-05/workspace-note.txt',
            createdByAgentInstanceId: agentInstanceId.toString(),
            lastModifiedByAgentInstanceId: agentInstanceId.toString(),
            createdByAgentName: 'Legacy Workspace Agent',
            lastModifiedByAgentName: 'Legacy Workspace Agent',
            isOrphan: false,
        }));
        expect(migratedWorkspaceMedia?.orphanedAt).toBeUndefined();
        expect(migratedWorkspaceMedia?.orphanReason).toBeUndefined();

        const migratedCloudMedia = snapshot.find((doc) => doc.fileName === 'cloud-artifact.txt');
        expect(migratedCloudMedia).toEqual(expect.objectContaining({
            primaryStorageMode: 'cloud',
            canonicalLocator: 's3://media-bucket/tenant/cloud-artifact.txt',
            cloudConnectionProfileId: 'cloud-profile-legacy-1',
            createdByAgentInstanceId: agentInstanceId.toString(),
            lastModifiedByAgentInstanceId: agentInstanceId.toString(),
            createdByAgentName: 'Legacy Cloud Agent',
            lastModifiedByAgentName: 'Legacy Cloud Agent',
            isOrphan: false,
        }));

        expect(mediaCollection.indexSnapshot()).toHaveLength(9);
        expect(mediaCollection.indexSnapshot()).toEqual(expect.arrayContaining([
            expect.objectContaining({
                keys: { userId: 1, workflowId: 1, canonicalLocator: 1 },
                options: expect.objectContaining({
                    unique: true,
                    name: 'uq_media_reference_user_workflow_locator',
                }),
            }),
            expect.objectContaining({
                keys: { userId: 1, workflowId: 1, journalEntryId: 1 },
                options: expect.objectContaining({
                    unique: true,
                    name: 'uq_media_reference_user_workflow_journal',
                }),
            }),
        ]));
    });

    it('marks documents as blocked when no canonical locator can be derived', async () => {
        const mediaCollection = new FakeCollection([{
            _id: new mongoose.Types.ObjectId(),
            userId: new mongoose.Types.ObjectId(),
            workflowId: new mongoose.Types.ObjectId(),
            agentInstanceId: new mongoose.Types.ObjectId(),
            storageMode: 'cloud',
            fileName: 'unresolved.bin',
            originalName: 'unresolved.bin',
            mimeType: 'application/octet-stream',
            size: 5,
        }]);

        const db = new FakeDb({ media_references: mediaCollection });
        const summary = await backfillMediaReferenceCatalogFields(db as any);

        expect(summary).toEqual({
            collectionFound: true,
            scanned: 1,
            updated: 0,
            alreadyCompatible: 0,
            blocked: 1,
            indexesEnsured: 9,
        });
        expect(mediaCollection.snapshot()[0]?.canonicalLocator).toBeUndefined();
    });
});
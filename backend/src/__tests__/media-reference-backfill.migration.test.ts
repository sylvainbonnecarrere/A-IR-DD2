import mongoose from 'mongoose';
import { backfillMediaReferenceCatalogFields } from '../migrations/006_media_reference_catalog_backfill';

class FakeCollection {
    private readonly docs = new Map<string, any>();
    private readonly indexes: Array<Record<string, number>> = [];

    constructor(initialDocs: any[] = []) {
        initialDocs.forEach((doc) => {
            this.docs.set(this.getKey(doc._id), this.clone(doc));
        });
    }

    find() {
        return {
            toArray: async () => Array.from(this.docs.values()).map((doc) => this.clone(doc)),
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

    async createIndex(index: Record<string, number>) {
        this.indexes.push(this.clone(index));
        return `idx_${this.indexes.length}`;
    }

    snapshot(): any[] {
        return Array.from(this.docs.values()).map((doc) => this.clone(doc));
    }

    indexSnapshot(): Array<Record<string, number>> {
        return this.indexes.map((index) => this.clone(index));
    }

    private matches(doc: Record<string, any>, filter: Record<string, unknown>): boolean {
        return Object.entries(filter).every(([key, value]) => this.toComparable(doc[key]) === this.toComparable(value));
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
    it('backfills additive catalog fields for legacy db and workspace documents and ensures indexes', async () => {
        const agentInstanceId = new mongoose.Types.ObjectId();
        const journalEntryId = new mongoose.Types.ObjectId();
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

        const mediaCollection = new FakeCollection([dbMedia, workspaceMedia, alreadyCompatible]);
        const db = new FakeDb({ media_references: mediaCollection });

        const summary = await backfillMediaReferenceCatalogFields(db as any);
        const snapshot = mediaCollection.snapshot();

        expect(summary).toEqual({
            collectionFound: true,
            scanned: 3,
            updated: 2,
            alreadyCompatible: 1,
            blocked: 0,
            indexesEnsured: 7,
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

        expect(mediaCollection.indexSnapshot()).toHaveLength(7);
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
            indexesEnsured: 7,
        });
        expect(mediaCollection.snapshot()[0]?.canonicalLocator).toBeUndefined();
    });
});
import mongoose from 'mongoose';
import { migrateLegacyUserFunctionsToUserToolsAndDropCollection } from '../migrations/005_user_functions_eol';

class FakeCollection {
    private readonly docs = new Map<string, any>();

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

    async findOne(filter: Record<string, unknown>, options?: { projection?: Record<string, number> }) {
        const match = Array.from(this.docs.values()).find((doc) => this.matches(doc, filter));
        if (!match) {
            return null;
        }

        if (!options?.projection) {
            return this.clone(match);
        }

        const projected: Record<string, unknown> = {};
        Object.keys(options.projection).forEach((field) => {
            if (field in match) {
                projected[field] = match[field];
            }
        });

        return this.clone(projected);
    }

    async insertOne(doc: Record<string, unknown>) {
        this.docs.set(this.getKey(doc._id), this.clone(doc));
        return { acknowledged: true, insertedId: doc._id };
    }

    snapshot(): any[] {
        return Array.from(this.docs.values()).map((doc) => this.clone(doc));
    }

    private matches(doc: Record<string, any>, filter: Record<string, unknown>): boolean {
        return Object.entries(filter).every(([key, value]) => {
            return this.toComparable(doc[key]) === this.toComparable(value);
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
    private readonly dropped = new Set<string>();

    constructor(collections: Record<string, FakeCollection>) {
        this.collections = collections;
    }

    listCollections(filter?: { name?: string }) {
        return {
            toArray: async () => {
                const names = Object.keys(this.collections)
                    .filter((name) => !this.dropped.has(name))
                    .filter((name) => !filter?.name || name === filter.name);

                return names.map((name) => ({ name }));
            },
        };
    }

    collection(name: string): FakeCollection {
        const collection = this.collections[name];
        if (!collection || this.dropped.has(name)) {
            throw new Error(`Unknown fake collection: ${name}`);
        }

        return collection;
    }

    async dropCollection(name: string): Promise<void> {
        if (!this.collections[name]) {
            throw new Error(`Unknown fake collection: ${name}`);
        }

        this.dropped.add(name);
    }

    hasCollection(name: string): boolean {
        return !!this.collections[name] && !this.dropped.has(name);
    }
}

function buildLegacyFunction(overrides: Partial<Record<string, unknown>> = {}) {
    return {
        _id: new mongoose.Types.ObjectId(),
        userId: new mongoose.Types.ObjectId(),
        workflowId: new mongoose.Types.ObjectId(),
        name: 'legacy_custom_tool',
        description: 'Legacy custom tool',
        language: 'typescript',
        origin: 'custom',
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
        codeInline: 'export function run() { return { ok: true }; }',
        codePath: null,
        dependencies: { npm: ['zod'], python: [] },
        isEnabled: true,
        isReadonly: false,
        version: 1,
        tags: ['legacy'],
        createdAt: new Date('2026-05-01T10:00:00.000Z'),
        updatedAt: new Date('2026-05-02T10:00:00.000Z'),
        ...overrides,
    };
}

describe('user_functions EOL migration', () => {
    it('drops the empty legacy collection when no user_functions documents remain', async () => {
        const db = new FakeDb({
            user_functions: new FakeCollection([]),
            user_tools: new FakeCollection([]),
        });

        const summary = await migrateLegacyUserFunctionsToUserToolsAndDropCollection(db as any);

        expect(summary).toEqual({
            collectionFound: true,
            scanned: 0,
            created: 0,
            skippedExistingById: 0,
            blockedByLogicalConflict: 0,
            dropped: true,
        });
        expect(db.hasCollection('user_functions')).toBe(false);
    });

    it('migrates missing legacy documents into user_tools before dropping user_functions', async () => {
        const legacyFunction = buildLegacyFunction();
        const db = new FakeDb({
            user_functions: new FakeCollection([legacyFunction]),
            user_tools: new FakeCollection([]),
        });

        const summary = await migrateLegacyUserFunctionsToUserToolsAndDropCollection(db as any);
        const userTools = db.collection('user_tools').snapshot();

        expect(summary).toEqual({
            collectionFound: true,
            scanned: 1,
            created: 1,
            skippedExistingById: 0,
            blockedByLogicalConflict: 0,
            dropped: true,
        });
        expect(userTools).toHaveLength(1);
        expect(userTools[0]).toEqual(expect.objectContaining({
            _id: legacyFunction._id.toString(),
            name: legacyFunction.name,
            scopeType: 'user',
            ownerUserId: legacyFunction.userId.toString(),
            workflowId: legacyFunction.workflowId.toString(),
        }));
        expect(db.hasCollection('user_functions')).toBe(false);
    });

    it('keeps the legacy collection when a conflicting canonical tool already exists under another id', async () => {
        const legacyFunction = buildLegacyFunction();
        const db = new FakeDb({
            user_functions: new FakeCollection([legacyFunction]),
            user_tools: new FakeCollection([{
                _id: new mongoose.Types.ObjectId(),
                scopeType: 'user',
                ownerUserId: legacyFunction.userId,
                workflowId: legacyFunction.workflowId,
                name: legacyFunction.name,
            }]),
        });

        const summary = await migrateLegacyUserFunctionsToUserToolsAndDropCollection(db as any);

        expect(summary).toEqual({
            collectionFound: true,
            scanned: 1,
            created: 0,
            skippedExistingById: 0,
            blockedByLogicalConflict: 1,
            dropped: false,
        });
        expect(db.hasCollection('user_functions')).toBe(true);
    });
});
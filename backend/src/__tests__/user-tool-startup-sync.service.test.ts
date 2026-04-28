import mongoose from 'mongoose';
import {
    syncUserToolsFromLegacyFunctionsOnStartup,
    getRepairOnlyProtectedFields
} from '../services/userToolStartupSync.service';
import { mapLegacyFunctionToUserToolFields } from '../utils/userToolLegacyMapper';

type LegacyFunctionDoc = {
    _id: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    workflowId: mongoose.Types.ObjectId;
    name: string;
    displayName?: string;
    description: string;
    language: 'python' | 'typescript';
    origin: 'native' | 'custom';
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    codePath?: string | null;
    codeInline?: string | null;
    dependencies?: {
        python?: string[];
        npm?: string[];
    };
    isEnabled: boolean;
    isReadonly: boolean;
    version?: number | string;
    tags?: string[];
    createdAt: Date;
    updatedAt: Date;
};

class FakeCollection {
    private readonly docs = new Map<string, any>();

    constructor(initialDocs: any[] = []) {
        initialDocs.forEach((doc) => {
            this.docs.set(this.getKey(doc._id), this.clone(doc));
        });
    }

    find() {
        return {
            toArray: async () => Array.from(this.docs.values()).map((doc) => this.clone(doc))
        };
    }

    async findOne(filter: { _id: unknown }, options?: { projection?: Record<string, number> }) {
        const existing = this.docs.get(this.getKey(filter._id));
        if (!existing) {
            return null;
        }

        if (options?.projection) {
            const projected: Record<string, unknown> = {};
            Object.keys(options.projection).forEach((field) => {
                if (field in existing) {
                    projected[field] = existing[field];
                }
            });
            return this.clone(projected);
        }

        return this.clone(existing);
    }

    async updateOne(
        filter: { _id: unknown },
        update: { $set?: Record<string, unknown>; $setOnInsert?: Record<string, unknown> },
        options?: { upsert?: boolean }
    ) {
        const key = this.getKey(filter._id);
        const existing = this.docs.get(key);

        if (existing) {
            if (update.$set) {
                const merged = {
                    ...existing,
                    ...this.clone(update.$set)
                };
                this.docs.set(key, merged);
                return { upsertedCount: 0, modifiedCount: 1 };
            }

            return { upsertedCount: 0, modifiedCount: 0 };
        }

        if (options?.upsert) {
            const inserted = {
                _id: filter._id,
                ...this.clone(update.$setOnInsert ?? {}),
                ...this.clone(update.$set ?? {})
            };
            this.docs.set(key, inserted);
            return { upsertedCount: 1, modifiedCount: 0 };
        }

        return { upsertedCount: 0, modifiedCount: 0 };
    }

    getById(id: unknown) {
        return this.clone(this.docs.get(this.getKey(id)));
    }

    private getKey(id: unknown): string {
        if (id instanceof mongoose.Types.ObjectId) {
            return id.toString();
        }

        return String(id);
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

    collection(name: string): FakeCollection {
        const collection = this.collections[name];
        if (!collection) {
            throw new Error(`Unknown fake collection: ${name}`);
        }

        return collection;
    }
}

function buildLegacyFunction(overrides: Partial<LegacyFunctionDoc> = {}): LegacyFunctionDoc {
    return {
        _id: new mongoose.Types.ObjectId(),
        userId: new mongoose.Types.ObjectId(),
        workflowId: new mongoose.Types.ObjectId(),
        name: 'transcribe_report',
        displayName: 'Transcribe Report',
        description: 'Legacy tool description',
        language: 'python',
        origin: 'custom',
        inputSchema: { type: 'object', properties: { prompt: { type: 'string' } } },
        outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
        codePath: 'tools/transcribe.py',
        codeInline: null,
        dependencies: { python: ['pandas==2.2.0'], npm: [] },
        isEnabled: true,
        isReadonly: false,
        version: 1,
        tags: ['audio'],
        createdAt: new Date('2026-03-17T09:00:00.000Z'),
        updatedAt: new Date('2026-03-17T09:00:00.000Z'),
        ...overrides
    };
}

describe('userToolStartupSync service', () => {
    const originalPhase = process.env.USER_TOOLS_STARTUP_SYNC_PHASE;

    afterEach(() => {
        if (originalPhase === undefined) {
            delete process.env.USER_TOOLS_STARTUP_SYNC_PHASE;
            return;
        }

        process.env.USER_TOOLS_STARTUP_SYNC_PHASE = originalPhase;
    });

    it('mirrors and updates legacy functions in legacy-authority mode', async () => {
        process.env.USER_TOOLS_STARTUP_SYNC_PHASE = 'legacy-authority';

        const legacyFunction = buildLegacyFunction();
        const userFunctions = new FakeCollection([legacyFunction]);
        const userTools = new FakeCollection();
        const db = new FakeDb({
            user_functions: userFunctions,
            user_tools: userTools
        });

        const firstSummary = await syncUserToolsFromLegacyFunctionsOnStartup(db as any);

        expect(firstSummary).toEqual({
            phase: 'legacy-authority',
            scanned: 1,
            created: 1,
            updated: 0,
            skippedExisting: 0
        });

        const firstMirror = userTools.getById(legacyFunction._id);
        expect(firstMirror).toEqual(expect.objectContaining({
            workflowId: legacyFunction.workflowId.toString(),
            name: 'transcribe_report',
            displayName: 'Transcribe Report',
            description: 'Legacy tool description',
            runtime: 'python',
            status: 'ready'
        }));
        expect(firstMirror.currentVersion).toEqual(expect.objectContaining({
            versionTag: '1',
            sourceMode: 'path',
            sourcePath: 'tools/transcribe.py'
        }));

        const updatedLegacyFunction = buildLegacyFunction({
            ...legacyFunction,
            description: 'Updated legacy description',
            isEnabled: false,
            version: 2,
            updatedAt: new Date('2026-03-17T10:30:00.000Z')
        });
        const replacementFunctions = new FakeCollection([updatedLegacyFunction]);
        const updatedDb = new FakeDb({
            user_functions: replacementFunctions,
            user_tools: userTools
        });

        const secondSummary = await syncUserToolsFromLegacyFunctionsOnStartup(updatedDb as any);

        expect(secondSummary).toEqual({
            phase: 'legacy-authority',
            scanned: 1,
            created: 0,
            updated: 1,
            skippedExisting: 0
        });

        const updatedMirror = userTools.getById(legacyFunction._id);
        expect(updatedMirror).toEqual(expect.objectContaining({
            description: 'Updated legacy description',
            status: 'disabled',
            updatedAt: '2026-03-17T10:30:00.000Z'
        }));
        expect(updatedMirror.currentVersion).toEqual(expect.objectContaining({
            versionTag: '2'
        }));
    });

    it('creates missing mirrors only in repair-only mode and preserves protected fields', async () => {
        process.env.USER_TOOLS_STARTUP_SYNC_PHASE = 'repair-only';

        const existingLegacyFunction = buildLegacyFunction();
        const missingLegacyFunction = buildLegacyFunction({
            _id: new mongoose.Types.ObjectId(),
            name: 'summarize_notes',
            displayName: 'Summarize Notes',
            description: 'Missing mirror should be created',
            language: 'typescript',
            codePath: null,
            codeInline: 'export const run = async () => true;',
            dependencies: { npm: ['zod'], python: [] },
            version: 5
        });

        const protectedWorkspaceId = new mongoose.Types.ObjectId().toString();
        const preexistingMirror = {
            _id: existingLegacyFunction._id,
            workspaceId: protectedWorkspaceId,
            policy: { networkMode: 'restricted', writablePaths: ['/safe'], secretAliases: ['vault'] },
            currentVersion: { versionTag: 'target-owned-version' },
            versions: [{ versionTag: 'target-owned-version' }],
            dependencies: { npm: ['vitest'], python: ['numpy'] },
            description: 'Target-owned description',
            runtime: 'typescript',
            name: 'target_owned_name',
            status: 'ready'
        };

        const db = new FakeDb({
            user_functions: new FakeCollection([existingLegacyFunction, missingLegacyFunction]),
            user_tools: new FakeCollection([preexistingMirror])
        });

        const summary = await syncUserToolsFromLegacyFunctionsOnStartup(db as any);

        expect(summary).toEqual({
            phase: 'repair-only',
            scanned: 2,
            created: 1,
            updated: 0,
            skippedExisting: 1
        });

        const preservedMirror = db.collection('user_tools').getById(existingLegacyFunction._id);
        expect(preservedMirror).toEqual(expect.objectContaining({
            workspaceId: protectedWorkspaceId,
            description: 'Target-owned description',
            name: 'target_owned_name',
            runtime: 'typescript'
        }));
        expect(preservedMirror.policy).toEqual({
            networkMode: 'restricted',
            writablePaths: ['/safe'],
            secretAliases: ['vault']
        });
        expect(preservedMirror.currentVersion).toEqual({ versionTag: 'target-owned-version' });
        expect(getRepairOnlyProtectedFields()).toEqual(expect.arrayContaining([
            'workspaceId',
            'policy',
            'currentVersion',
            'versions',
            'dependencies',
            'description',
            'runtime',
            'name'
        ]));

        const createdMirror = db.collection('user_tools').getById(missingLegacyFunction._id);
        expect(createdMirror).toEqual(expect.objectContaining({
            workflowId: missingLegacyFunction.workflowId.toString(),
            name: 'summarize_notes',
            displayName: 'Summarize Notes',
            description: 'Missing mirror should be created',
            runtime: 'typescript',
            status: 'ready'
        }));
        expect(createdMirror.currentVersion).toEqual(expect.objectContaining({
            versionTag: '5',
            sourceMode: 'inline'
        }));
    });

    it('preserves version readiness state in legacy-authority mode when the mirrored source is unchanged', async () => {
        process.env.USER_TOOLS_STARTUP_SYNC_PHASE = 'legacy-authority';

        const legacyFunction = buildLegacyFunction({
            _id: new mongoose.Types.ObjectId(),
            name: 'web_search_py',
            origin: 'native',
            userId: null as any,
            workflowId: null as any,
            language: 'python',
            codePath: 'backend/python/native/web_search_py.py',
            dependencies: { python: ['duckduckgo-search==6.1.0'], npm: [] },
            isReadonly: true,
            version: 'v-ready',
            updatedAt: new Date('2026-03-31T12:00:00.000Z')
        });
        const baselineCurrentVersion = mapLegacyFunctionToUserToolFields(legacyFunction as any) as any;

        const preexistingMirror = {
            _id: legacyFunction._id,
            ownerUserId: null,
            scopeType: 'native',
            name: 'web_search_py',
            runtime: 'python',
            currentVersion: {
                versionTag: 'v-ready',
                contentHash: baselineCurrentVersion.currentVersion.contentHash,
                buildStatus: 'built',
                validationStatus: 'valid'
            },
            versions: [{
                versionTag: 'v-ready',
                contentHash: baselineCurrentVersion.currentVersion.contentHash,
                buildStatus: 'built',
                validationStatus: 'valid'
            }]
        };

        const db = new FakeDb({
            user_functions: new FakeCollection([legacyFunction]),
            user_tools: new FakeCollection([preexistingMirror])
        });

        const summary = await syncUserToolsFromLegacyFunctionsOnStartup(db as any);

        expect(summary).toEqual({
            phase: 'legacy-authority',
            scanned: 1,
            created: 0,
            updated: 1,
            skippedExisting: 0
        });

        const preservedMirror = db.collection('user_tools').getById(legacyFunction._id);
        expect(preservedMirror.currentVersion).toEqual(expect.objectContaining({
            versionTag: 'v-ready',
            buildStatus: 'built',
            validationStatus: 'valid'
        }));
        expect(preservedMirror.versions).toEqual([
            expect.objectContaining({
                versionTag: 'v-ready',
                buildStatus: 'built',
                validationStatus: 'valid'
            })
        ]);
    });
});
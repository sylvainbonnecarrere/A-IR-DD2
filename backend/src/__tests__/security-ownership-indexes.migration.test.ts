import { ensureSecurityOwnershipIndexes } from '../migrations/007_security_ownership_indexes';

class FakeCollection {
    private readonly indexes = new Map<string, { keys: Record<string, number>; options: Record<string, any> }>();

    async createIndex(keys: Record<string, number>, options: Record<string, any> = {}) {
        this.indexes.set(options.name || JSON.stringify(keys), { keys: { ...keys }, options: { ...options } });
        return options.name || JSON.stringify(keys);
    }

    listIndexes() {
        return {
            toArray: async () => Array.from(this.indexes.values()).map((index) => ({ ...index.options, key: { ...index.keys } })),
        };
    }

    snapshot() {
        return Array.from(this.indexes.values()).map((index) => ({ keys: { ...index.keys }, options: { ...index.options } }));
    }
}

class FakeDb {
    constructor(private readonly collections: Record<string, FakeCollection>) {}

    listCollections(filter?: { name?: string }) {
        return {
            toArray: async () => Object.keys(this.collections)
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
}

describe('security ownership indexes migration', () => {
    it('creates the required ownership indexes once and becomes idempotent on re-run', async () => {
        const workflows = new FakeCollection();
        const workflowNodes = new FakeCollection();
        const workflowEdges = new FakeCollection();
        const agentInstances = new FakeCollection();
        const db = new FakeDb({
            workflows,
            workflow_nodes_v2: workflowNodes,
            workflow_edges: workflowEdges,
            agent_instances: agentInstances,
        });

        const firstRun = await ensureSecurityOwnershipIndexes(db as any);
        const secondRun = await ensureSecurityOwnershipIndexes(db as any);

        expect(firstRun).toEqual({
            collectionsFound: 4,
            indexesCreated: 4,
            indexesSkipped: 0,
        });
        expect(secondRun).toEqual({
            collectionsFound: 4,
            indexesCreated: 0,
            indexesSkipped: 4,
        });

        expect(workflowEdges.snapshot()).toEqual(expect.arrayContaining([
            expect.objectContaining({
                keys: { userId: 1, workflowId: 1, updatedAt: -1 },
                options: expect.objectContaining({ name: 'idx_workflow_edges_owner_workflow_updated' }),
            }),
        ]));
        expect(workflows.snapshot()).toEqual(expect.arrayContaining([
            expect.objectContaining({
                keys: { userId: 1, isDefault: 1 },
                options: expect.objectContaining({
                    name: 'uq_workflows_default_per_user',
                    unique: true,
                }),
            }),
        ]));
    });
});
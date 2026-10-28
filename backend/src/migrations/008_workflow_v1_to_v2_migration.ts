import mongoose from 'mongoose';

const DEFAULT_MONGODB_URI = 'mongodb://localhost:27017/aitest';

export interface WorkflowV1ToV2MigrationSummary {
    workflowsScanned: number;
    workflowsMigrated: number;
    nodesCreated: number;
    edgesCreated: number;
    duplicatesPrevented: number;
}

interface LegacyWorkflowNodeLike {
    _id?: unknown;
    id?: string;
    instanceId?: unknown;
    nodeType?: string;
    position?: { x?: number; y?: number };
    data?: Record<string, unknown>;
    createdAt?: Date | string | number;
    updatedAt?: Date | string | number;
}

interface LegacyWorkflowEdgeLike {
    _id?: unknown;
    id?: string;
    source?: string | unknown;
    target?: string | unknown;
    sourceInstanceId?: unknown;
    targetInstanceId?: unknown;
    sourceHandle?: string;
    targetHandle?: string;
    type?: string;
    edgeType?: string;
    label?: string;
    animated?: boolean;
    createdAt?: Date | string | number;
    updatedAt?: Date | string | number;
}

function toStringValue(value: unknown): string {
    if (value == null) {
        return '';
    }

    if (typeof value === 'string') {
        return value;
    }

    if (value instanceof mongoose.Types.ObjectId) {
        return value.toString();
    }

    if (typeof value === 'object' && 'toString' in value && typeof (value as { toString: () => string }).toString === 'function') {
        return String(value);
    }

    return String(value);
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

function buildLegacyNodeSignature(node: LegacyWorkflowNodeLike): string {
    const workflowNodeId = toStringValue(node.id ?? node.instanceId ?? node._id ?? '');
    const instanceId = toStringValue(node.instanceId ?? '');
    const nodeType = node.nodeType ?? 'agent';
    return `${workflowNodeId}:${instanceId}:${nodeType}`;
}

function buildLegacyEdgeSignature(edge: LegacyWorkflowEdgeLike): string {
    const source = toStringValue(edge.sourceInstanceId ?? edge.source ?? '');
    const target = toStringValue(edge.targetInstanceId ?? edge.target ?? '');
    const type = edge.edgeType ?? edge.type ?? 'default';
    return `${source}->${target}:${type}`;
}

function buildV2NodeRecord(workflow: any, node: LegacyWorkflowNodeLike) {
    const objectId = toStringValue(workflow._id ?? workflow.id ?? '');
    const userId = toStringValue(workflow.userId ?? workflow.ownerId ?? '');
    const instanceId = node.instanceId ? toStringValue(node.instanceId) : undefined;
    const persistedPosition = node.position ?? { x: 0, y: 0 };
    const uiLabel = node.data?.label ?? node.data?.name ?? node.id ?? 'node';
    const legacyNodeId = toStringValue(node.id ?? node.instanceId ?? node._id ?? '');

    return {
        workflowId: objectId,
        ownerId: userId,
        nodeType: node.nodeType ?? 'agent',
        instanceId: instanceId ? new mongoose.Types.ObjectId(instanceId) : undefined,
        position: {
            x: Number.isFinite(persistedPosition.x) ? persistedPosition.x : 0,
            y: Number.isFinite(persistedPosition.y) ? persistedPosition.y : 0,
        },
        uiConfig: {
            label: uiLabel,
            expanded: true,
        },
        nodeData: node.data ?? {},
        metadata: {
            legacyNodeId,
            legacyInstanceId: instanceId,
            importedFromV1: true,
        },
        createdAt: normalizeDate(node.createdAt ?? workflow.createdAt),
        updatedAt: normalizeDate(node.updatedAt ?? workflow.updatedAt ?? new Date()),
    };
}

function buildV2EdgeRecord(workflow: any, edge: LegacyWorkflowEdgeLike) {
    const workflowId = toStringValue(workflow._id ?? workflow.id ?? '');
    const userId = toStringValue(workflow.userId ?? workflow.ownerId ?? '');
    const sourceInstanceId = toStringValue(edge.sourceInstanceId ?? edge.source ?? '');
    const targetInstanceId = toStringValue(edge.targetInstanceId ?? edge.target ?? '');

    return {
        workflowId,
        userId,
        sourceInstanceId: sourceInstanceId ? new mongoose.Types.ObjectId(sourceInstanceId) : undefined,
        targetInstanceId: targetInstanceId ? new mongoose.Types.ObjectId(targetInstanceId) : undefined,
        sourceHandle: edge.sourceHandle ?? 'source',
        targetHandle: edge.targetHandle ?? 'target',
        edgeType: (edge.edgeType ?? edge.type ?? 'default') as 'default' | 'step' | 'smoothstep' | 'straight',
        animated: Boolean(edge.animated),
        label: edge.label ?? '',
        createdAt: normalizeDate(edge.createdAt ?? workflow.createdAt),
        updatedAt: normalizeDate(edge.updatedAt ?? workflow.updatedAt ?? new Date()),
    };
}

export async function migrateLegacyWorkflowGraphsToV2(db: any): Promise<WorkflowV1ToV2MigrationSummary> {
    const workflowCollection = db.collection ? db.collection('workflows') : null;
    const nodeCollection = db.collection ? db.collection('workflow_nodes_v2') : null;
    const edgeCollection = db.collection ? db.collection('workflow_edges') : null;
    const migrationCollection = db.collection ? db.collection('workflow_migrations') : null;

    if (!workflowCollection || !nodeCollection || !edgeCollection || !migrationCollection) {
        return {
            workflowsScanned: 0,
            workflowsMigrated: 0,
            nodesCreated: 0,
            edgesCreated: 0,
            duplicatesPrevented: 0,
        };
    }

    const workflows = await workflowCollection.find({}).toArray();
    const summary: WorkflowV1ToV2MigrationSummary = {
        workflowsScanned: workflows.length,
        workflowsMigrated: 0,
        nodesCreated: 0,
        edgesCreated: 0,
        duplicatesPrevented: 0,
    };

    for (const workflow of workflows) {
        const workflowId = toStringValue(workflow._id ?? workflow.id ?? '');
        if (!workflowId) {
            continue;
        }

        const legacyNodes = Array.isArray(workflow.nodes) ? workflow.nodes as LegacyWorkflowNodeLike[] : [];
        const legacyEdges = Array.isArray(workflow.edges) ? workflow.edges as LegacyWorkflowEdgeLike[] : [];

        const currentNodes = await nodeCollection.find({ workflowId }).toArray();
        const currentEdges = await edgeCollection.find({ workflowId }).toArray();
        const existingNodeSignatures = new Set(currentNodes.map((node: any) => buildLegacyNodeSignature({
            _id: node.metadata?.legacyNodeId ?? node._id,
            id: node.metadata?.legacyNodeId ?? node.id ?? node.instanceId,
            instanceId: node.instanceId,
            nodeType: node.nodeType,
            position: node.position,
            data: node.nodeData,
        })));
        const existingEdgeSignatures = new Set(currentEdges.map((edge: any) => buildLegacyEdgeSignature({
            sourceInstanceId: edge.sourceInstanceId,
            targetInstanceId: edge.targetInstanceId,
            edgeType: edge.edgeType,
            label: edge.label,
        })));

        const checkpoint = await migrationCollection.findOne({
            workflowId,
            sourceVersion: 'v1',
            targetVersion: 'v2',
            status: 'completed',
        });

        const legacyNodeSignatures = new Set(legacyNodes.map((node) => buildLegacyNodeSignature(node)));
        const legacyEdgeSignatures = new Set(legacyEdges.map((edge) => buildLegacyEdgeSignature(edge)));
        const hasMissingNodeRecords = [...legacyNodeSignatures].some((signature) => !existingNodeSignatures.has(signature));
        const hasMissingEdgeRecords = [...legacyEdgeSignatures].some((signature) => !existingEdgeSignatures.has(signature));

        if (checkpoint && !hasMissingNodeRecords && !hasMissingEdgeRecords) {
            summary.duplicatesPrevented += currentNodes.length;
            continue;
        }

        for (const node of legacyNodes) {
            const signature = buildLegacyNodeSignature(node);
            if (existingNodeSignatures.has(signature)) {
                summary.duplicatesPrevented += 1;
                continue;
            }

            await nodeCollection.insertOne(buildV2NodeRecord(workflow, node));
            existingNodeSignatures.add(signature);
            summary.nodesCreated += 1;
        }

        for (const edge of legacyEdges) {
            const signature = buildLegacyEdgeSignature(edge);
            if (existingEdgeSignatures.has(signature)) {
                summary.duplicatesPrevented += 1;
                continue;
            }

            await edgeCollection.insertOne(buildV2EdgeRecord(workflow, edge));
            existingEdgeSignatures.add(signature);
            summary.edgesCreated += 1;
        }

        const migrationRow = {
            workflowId,
            sourceVersion: 'v1',
            targetVersion: 'v2',
            status: 'completed',
            nodesCreated: summary.nodesCreated,
            edgesCreated: summary.edgesCreated,
            migratedAt: new Date(),
        };

        await migrationCollection.insertOne(migrationRow);
        summary.workflowsMigrated += 1;
    }

    return summary;
}

async function runUp(): Promise<void> {
    const mongoUri = process.env.MONGODB_URI || DEFAULT_MONGODB_URI;
    await mongoose.connect(mongoUri);

    try {
        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('MongoDB database handle unavailable');
        }

        const summary = await migrateLegacyWorkflowGraphsToV2(db);
        console.log(
            `[Migration 008] workflow V1 -> V2 migration: scanned=${summary.workflowsScanned} migrated=${summary.workflowsMigrated} nodesCreated=${summary.nodesCreated} edgesCreated=${summary.edgesCreated} duplicatesPrevented=${summary.duplicatesPrevented}`
        );
    } finally {
        await mongoose.connection.close();
    }
}

const direction = process.argv[2] || 'up';
const isDirectCliInvocation = /(^|[\\/])008_workflow_v1_to_v2_migration\.(ts|js)$/.test(process.argv[1] ?? '');

if (isDirectCliInvocation) {
    if (direction !== 'up') {
        console.error(`[Migration 008] Direction non supportee: ${direction}. Seule la migration 'up' est autorisee.`);
        process.exit(1);
    }

    runUp().catch((err) => {
        console.error('[Migration 008] ERREUR:', err instanceof Error ? err.message : String(err));
        process.exit(1);
    });
}

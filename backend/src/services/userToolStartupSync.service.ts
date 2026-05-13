import { mapLegacyFunctionToUserToolFields } from '../utils/userToolLegacyMapper';

export type UserToolStartupSyncPhase = 'repair-only';

interface StartupSyncSummary {
    phase: UserToolStartupSyncPhase;
    scanned: number;
    created: number;
    updated: number;
    skippedExisting: number;
}

interface StartupSyncPolicy {
    phase: UserToolStartupSyncPhase;
    synchronize(db: any): Promise<StartupSyncSummary>;
}

const USER_TOOL_REPAIR_ONLY_PROTECTED_FIELDS = [
    'currentVersion',
    'versions',
    'workspaceId',
    'policy',
    'status',
    'inputSchema',
    'outputSchema',
    'dependencies',
    'tags',
    'description',
    'displayName',
    'runtime',
    'name'
] as const;

function normalizeDate(value: unknown): Date {
    if (value instanceof Date) {
        return value;
    }

    if (typeof value === 'string' || typeof value === 'number') {
        const normalized = new Date(value);
        if (!Number.isNaN(normalized.getTime())) {
            return normalized;
        }
    }

    return new Date();
}

function resolveStartupSyncPhase(): UserToolStartupSyncPhase {
    return 'repair-only';
}

class RepairOnlyStartupSyncPolicy implements StartupSyncPolicy {
    readonly phase: UserToolStartupSyncPhase = 'repair-only';

    async synchronize(db: any): Promise<StartupSyncSummary> {
        const legacyFunctions = await db.collection('user_functions').find({}).toArray();
        const userToolsCol = db.collection('user_tools');
        let created = 0;
        let skippedExisting = 0;

        for (const legacyFn of legacyFunctions) {
            const existingMirror = await userToolsCol.findOne(
                { _id: legacyFn._id },
                { projection: { _id: 1 } }
            );

            if (existingMirror) {
                skippedExisting++;
                continue;
            }

            const mapped = mapLegacyFunctionToUserToolFields(legacyFn);
            const createdAt = normalizeDate(legacyFn.createdAt);
            const updatedAt = normalizeDate(legacyFn.updatedAt);

            const result = await userToolsCol.updateOne(
                { _id: legacyFn._id },
                {
                    $setOnInsert: {
                        ...mapped,
                        createdAt,
                        updatedAt
                    }
                },
                { upsert: true }
            );

            if (result.upsertedCount > 0) {
                created++;
            }
        }

        return {
            phase: this.phase,
            scanned: legacyFunctions.length,
            created,
            updated: 0,
            skippedExisting
        };
    }
}

function createStartupSyncPolicy(): StartupSyncPolicy {
    return new RepairOnlyStartupSyncPolicy();
}

export async function syncUserToolsFromLegacyFunctionsOnStartup(db: any): Promise<StartupSyncSummary> {
    const policy = createStartupSyncPolicy();
    return policy.synchronize(db);
}

export function getUserToolStartupSyncPhase(): UserToolStartupSyncPhase {
    return resolveStartupSyncPhase();
}

export function getRepairOnlyProtectedFields(): readonly string[] {
    return USER_TOOL_REPAIR_ONLY_PROTECTED_FIELDS;
}
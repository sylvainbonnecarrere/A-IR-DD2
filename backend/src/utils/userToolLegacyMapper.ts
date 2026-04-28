import { createHash } from 'crypto';
import mongoose from 'mongoose';
import type { IUserToolPolicy, UserToolRunRuntime } from '../models';

type LegacyDependencies =
    | string[]
    | {
        python?: string[];
        npm?: string[];
    }
    | null
    | undefined;

export interface LegacyFunctionLike {
    _id?: mongoose.Types.ObjectId | string;
    userId?: mongoose.Types.ObjectId | string | null;
    workflowId?: mongoose.Types.ObjectId | string | null;
    name: string;
    displayName?: string;
    description: string;
    language: 'python' | 'typescript';
    origin: 'native' | 'custom';
    inputSchema?: object;
    outputSchema?: object;
    codePath?: string | null;
    codeInline?: string | null;
    dependencies?: LegacyDependencies;
    isEnabled: boolean;
    isReadonly: boolean;
    version?: number | string;
    toolVersionTag?: string;
    toolContentHash?: string;
    policySnapshot?: IUserToolPolicy;
    tags?: string[];
    createdAt?: Date | string;
    updatedAt?: Date | string;
}

export interface LegacyFunctionExecutionMetadata {
    toolId: mongoose.Types.ObjectId;
    workflowId: mongoose.Types.ObjectId | null;
    runtime: UserToolRunRuntime;
    toolVersionTag: string;
    toolContentHash: string;
    policySnapshot: IUserToolPolicy;
}

interface ExistingUserToolVersionLike {
    versionTag?: string;
    contentHash?: string;
    buildStatus?: 'not_built' | 'building' | 'built' | 'failed';
    validationStatus?: 'unknown' | 'valid' | 'invalid';
}

interface ExistingUserToolLike {
    currentVersion?: ExistingUserToolVersionLike | null;
    versions?: ExistingUserToolVersionLike[] | null;
}

const NETWORK_ENABLED_NATIVE_FUNCTIONS = new Set([
    'web_search_py'
]);

const NATIVE_FUNCTION_POLICY_OVERRIDES: Partial<Record<string, IUserToolPolicy>> = {
    web_search_py: {
        networkMode: 'restricted',
        writablePaths: [],
        secretAliases: [],
        timeoutSeconds: 60,
        maxMemoryMb: 256
    }
};

function normalizeDate(value: Date | string | undefined): Date | undefined {
    if (!value) return undefined;
    const normalized = value instanceof Date ? value : new Date(value);
    return Number.isNaN(normalized.getTime()) ? undefined : normalized;
}

function normalizeDependencies(
    dependencies: LegacyDependencies,
    language: 'python' | 'typescript'
): { npm: string[]; python: string[] } {
    if (Array.isArray(dependencies)) {
        return language === 'python'
            ? { python: dependencies, npm: [] }
            : { npm: dependencies, python: [] };
    }

    return {
        npm: Array.isArray(dependencies?.npm) ? dependencies.npm : [],
        python: Array.isArray(dependencies?.python) ? dependencies.python : []
    };
}

function buildSourceMode(legacy: LegacyFunctionLike): 'inline' | 'path' {
    return legacy.codePath ? 'path' : 'inline';
}

function buildVersionTag(version: number | string | undefined): string {
    if (version === undefined || version === null || version === '') {
        return '1';
    }
    return String(version);
}

function buildContentHash(legacy: LegacyFunctionLike): string {
    const sourceMode = buildSourceMode(legacy);
    const dependencies = normalizeDependencies(legacy.dependencies, legacy.language);

    return createHash('sha256')
        .update(JSON.stringify({
            name: legacy.name,
            runtime: legacy.language,
            sourceMode,
            sourcePath: legacy.codePath ?? null,
            sourceInline: legacy.codeInline ?? null,
            dependencies,
            version: buildVersionTag(legacy.version)
        }))
        .digest('hex');
}

function buildDefaultPolicy(legacy: LegacyFunctionLike): IUserToolPolicy {
    if (legacy.policySnapshot) {
        return legacy.policySnapshot;
    }

    const explicitDefault = NATIVE_FUNCTION_POLICY_OVERRIDES[legacy.name];
    if (explicitDefault) {
        return explicitDefault;
    }

    const networkMode = legacy.origin === 'native' && NETWORK_ENABLED_NATIVE_FUNCTIONS.has(legacy.name)
        ? 'restricted'
        : 'none';

    return {
        networkMode,
        writablePaths: [],
        secretAliases: []
    };
}

function preserveVersionRuntimeState(
    mappedVersion: Record<string, unknown>,
    existingVersion?: ExistingUserToolVersionLike | null
): Record<string, unknown> {
    if (!existingVersion) {
        return mappedVersion;
    }

    if (
        existingVersion.versionTag !== mappedVersion.versionTag
        || existingVersion.contentHash !== mappedVersion.contentHash
    ) {
        return mappedVersion;
    }

    return {
        ...mappedVersion,
        buildStatus: existingVersion.buildStatus ?? mappedVersion.buildStatus,
        validationStatus: existingVersion.validationStatus ?? mappedVersion.validationStatus,
    };
}

export function mapLegacyFunctionToUserToolFields(
    legacy: LegacyFunctionLike,
    existingTool?: ExistingUserToolLike | null
): Record<string, unknown> {
    const sourceMode = buildSourceMode(legacy);
    const createdAt = normalizeDate(legacy.updatedAt) ?? normalizeDate(legacy.createdAt) ?? new Date();
    const dependencies = normalizeDependencies(legacy.dependencies, legacy.language);
    const versionTag = buildVersionTag(legacy.version);
    const contentHash = buildContentHash(legacy);
    const policy = buildDefaultPolicy(legacy);

    const mappedCurrentVersion = {
        versionTag,
        contentHash,
        sourceMode,
        sourcePath: legacy.codePath ?? null,
        sourceInline: legacy.codeInline ?? null,
        entrypoint: legacy.codePath ?? null,
        createdAt,
        createdBy: legacy.userId ?? null,
        buildStatus: 'not_built',
        validationStatus: 'unknown'
    };

    const currentVersion = preserveVersionRuntimeState(mappedCurrentVersion, existingTool?.currentVersion);
    const matchingExistingVersion = existingTool?.versions?.find(
        (candidate) => candidate.versionTag === versionTag && candidate.contentHash === contentHash
    );
    const versions = [preserveVersionRuntimeState(mappedCurrentVersion, matchingExistingVersion)];

    return {
        ownerUserId: legacy.origin === 'native' ? null : (legacy.userId ?? null),
        workspaceId: null,
        scopeType: legacy.origin === 'native' ? 'native' : 'user',
        workflowId: legacy.workflowId ?? null,
        name: legacy.name,
        displayName: legacy.displayName,
        description: legacy.description,
        runtime: legacy.language,
        status: legacy.isEnabled ? 'ready' : 'disabled',
        trustLevel: legacy.origin === 'native' ? 'internal' : 'user_private',
        currentVersion,
        versions,
        inputSchema: legacy.inputSchema ?? {},
        outputSchema: legacy.outputSchema ?? {},
        tags: Array.isArray(legacy.tags) ? legacy.tags : [],
        dependencies,
        policy,
        isReadonly: legacy.isReadonly,
        isEnabled: legacy.isEnabled
    };
}

export function deriveExecutionMetadataFromLegacyFunction(
    legacy: LegacyFunctionLike
): LegacyFunctionExecutionMetadata {
    if (!legacy._id) {
        throw new Error('Legacy function _id is required to derive execution metadata');
    }

    const toolId = legacy._id instanceof mongoose.Types.ObjectId
        ? legacy._id
        : new mongoose.Types.ObjectId(String(legacy._id));

    const workflowId = legacy.workflowId
        ? (legacy.workflowId instanceof mongoose.Types.ObjectId
            ? legacy.workflowId
            : new mongoose.Types.ObjectId(String(legacy.workflowId)))
        : null;

    return {
        toolId,
        workflowId,
        runtime: legacy.language,
        toolVersionTag: legacy.toolVersionTag ?? buildVersionTag(legacy.version),
        toolContentHash: legacy.toolContentHash ?? buildContentHash(legacy),
        policySnapshot: buildDefaultPolicy(legacy)
    };
}
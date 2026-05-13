import type { Agent, AgentInstance, ToolSelection } from '../types';
import type { UserFunction } from '../types/function.types';

export interface ResolvedToolSelection {
    toolId: string;
    versionTag?: string;
    versionNumber?: number;
    workspaceId?: string | null;
    function?: UserFunction;
    isMissing: boolean;
}

export interface SelectableToolViewModel {
    id: string;
    name: string;
    description: string;
    language: UserFunction['language'];
    origin: UserFunction['origin'];
    tags: string[];
    isEnabled: boolean;
    isReadonly: boolean;
    versionTag?: string;
    versionNumber?: number;
    workspaceId?: string | null;
    selected: boolean;
}

function buildFunctionIndex(functions: UserFunction[]): Map<string, UserFunction> {
    const index = new Map<string, UserFunction>();
    functions.forEach((fn) => {
        index.set(fn._id, fn);
        if (fn.toolId) {
            index.set(fn.toolId, fn);
        }
    });
    return index;
}

export function buildToolSelectionFromFunction(fn: Pick<UserFunction, '_id' | 'toolId' | 'versionTag' | 'version' | 'workspaceContext'>): ToolSelection {
    return {
        toolId: fn.toolId ?? fn._id,
        versionRef: {
            versionTag: fn.versionTag,
            versionNumber: fn.version,
            workspaceId: fn.workspaceContext?.workspaceId ?? null,
        },
    };
}

export function buildToolSelectionsFromFunctions(
    functionIds: string[],
    availableFunctions: UserFunction[]
): ToolSelection[] {
    const functionIndex = buildFunctionIndex(availableFunctions);

    return functionIds.map((toolId) => {
        const matchingFunction = functionIndex.get(toolId);
        return matchingFunction
            ? buildToolSelectionFromFunction(matchingFunction)
            : {
                toolId,
            };
    });
}

export function normalizeToolSelections(
    toolSelections: ToolSelection[] | undefined | null,
    legacyFunctionIds: string[] | undefined | null,
    availableFunctions: UserFunction[]
): ToolSelection[] {
    const functionIndex = buildFunctionIndex(availableFunctions);

    if (toolSelections && toolSelections.length > 0) {
        return toolSelections.map((selection) => {
            const matchingFunction = functionIndex.get(selection.toolId);
            const canonicalSelection = matchingFunction ? buildToolSelectionFromFunction(matchingFunction) : undefined;

            return {
                ...selection,
                toolId: matchingFunction?.toolId ?? selection.toolId,
                versionRef: selection.versionRef ?? canonicalSelection?.versionRef,
            };
        });
    }

    return buildToolSelectionsFromFunctions(legacyFunctionIds ?? [], availableFunctions);
}

export function deriveSelectedToolIds(
    toolSelections?: ToolSelection[] | null,
    legacyFunctionIds?: string[] | null
): string[] {
    if (toolSelections && toolSelections.length > 0) {
        return toolSelections.map((selection) => selection.toolId);
    }

    return legacyFunctionIds ?? [];
}

function normalizeToolIdList(rawValues: unknown[] | undefined): string[] {
    if (!Array.isArray(rawValues)) {
        return [];
    }

    return rawValues
        .map((value) => {
            if (typeof value === 'string') {
                return value;
            }

            if (value && typeof value === 'object' && 'toolId' in (value as Record<string, unknown>) && typeof (value as Record<string, unknown>).toolId === 'string') {
                return (value as Record<string, unknown>).toolId as string;
            }

            if (value && typeof value === 'object' && 'toString' in (value as Record<string, unknown>) && typeof (value as Record<string, unknown>).toString === 'function') {
                const stringValue = String(value);
                return stringValue !== '[object Object]' ? stringValue : '';
            }

            return '';
        })
        .filter((value): value is string => value.trim().length > 0);
}

export function resolveAgentSelectedToolIds(agent: Agent, agentInstance: AgentInstance | undefined): string[] {
    const instanceConfig = agentInstance?.configuration_json;
    const inheritance = instanceConfig?.functionInheritance;

    const instanceSelectionIds = inheritance?.inheritFromPrototype === false
        ? deriveSelectedToolIds(inheritance.overrideToolSelections, inheritance.overrideFunctionIds)
        : deriveSelectedToolIds(instanceConfig?.toolSelections || agentInstance?.toolSelections, undefined);

    const prototypeSelectionIds = deriveSelectedToolIds(agent.toolSelections, agent.functionIds);
    const fallbackToolIds = normalizeToolIdList((instanceConfig as Record<string, unknown> | undefined)?.tools as unknown[] | undefined)
        .concat(normalizeToolIdList((agentInstance as unknown as Record<string, unknown> | undefined)?.tools as unknown[] | undefined))
        .concat(normalizeToolIdList((agent as unknown as Record<string, unknown>).tools as unknown[] | undefined));

    return instanceSelectionIds.length > 0
        ? instanceSelectionIds
        : prototypeSelectionIds.length > 0
            ? prototypeSelectionIds
            : fallbackToolIds;
}

export function resolveAgentToolScope(agent: Agent, agentInstance: AgentInstance | undefined, availableFunctions: UserFunction[]): UserFunction[] {
    const selectedIds = resolveAgentSelectedToolIds(agent, agentInstance);

    if (selectedIds.length === 0) {
        return [];
    }

    const selectedIdSet = new Set(selectedIds);
    return availableFunctions.filter((fn) => {
        if (!fn.isEnabled) {
            return false;
        }

        return selectedIdSet.has(fn._id) || (fn.toolId ? selectedIdSet.has(fn.toolId) : false);
    });
}

export function hasLegacySelectedToolNamed(agent: Agent, agentInstance: AgentInstance | undefined, toolName: string): boolean {
    const candidateToolLists = [
        agentInstance?.configuration_json?.tools,
        (agentInstance as unknown as Record<string, unknown> | undefined)?.tools,
        agent.tools,
    ];

    return candidateToolLists.some((toolList) => Array.isArray(toolList) && toolList.some((tool) => {
        if (!tool || typeof tool !== 'object') {
            return false;
        }

        return (tool as Record<string, unknown>).name === toolName;
    }));
}

export function hasSelectedToolNamed(
    agent: Agent,
    agentInstance: AgentInstance | undefined,
    availableFunctions: UserFunction[],
    toolName: string
): boolean {
    if (hasLegacySelectedToolNamed(agent, agentInstance, toolName)) {
        return true;
    }

    const selectedIdSet = new Set(resolveAgentSelectedToolIds(agent, agentInstance));
    return availableFunctions.some((fn) => fn.isEnabled && fn.name === toolName && (selectedIdSet.has(fn._id) || (fn.toolId ? selectedIdSet.has(fn.toolId) : false)));
}

export function resolveToolSelections(
    toolSelections: ToolSelection[] | undefined,
    availableFunctions: UserFunction[]
): ResolvedToolSelection[] {
    const functionIndex = buildFunctionIndex(availableFunctions);

    return (toolSelections ?? []).map((selection) => {
        const matchingFunction = functionIndex.get(selection.toolId);
        return {
            toolId: selection.toolId,
            versionTag: selection.versionRef?.versionTag ?? matchingFunction?.versionTag,
            versionNumber: selection.versionRef?.versionNumber ?? matchingFunction?.version,
            workspaceId: selection.versionRef?.workspaceId ?? matchingFunction?.workspaceContext?.workspaceId ?? null,
            function: matchingFunction,
            isMissing: !matchingFunction,
        };
    });
}

export function buildSelectableToolCatalog(
    availableFunctions: UserFunction[],
    selectedIds: string[]
): SelectableToolViewModel[] {
    const selectedIdSet = new Set(selectedIds);

    return availableFunctions.map((fn) => ({
        id: fn.toolId ?? fn._id,
        name: fn.name,
        description: fn.description,
        language: fn.language,
        origin: fn.origin,
        tags: fn.tags,
        isEnabled: fn.isEnabled,
        isReadonly: fn.isReadonly,
        versionTag: fn.versionTag,
        versionNumber: fn.version,
        workspaceId: fn.workspaceContext?.workspaceId ?? null,
        selected: selectedIdSet.has(fn.toolId ?? fn._id) || selectedIdSet.has(fn._id),
    }));
}
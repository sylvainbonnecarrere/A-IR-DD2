import type { ToolSelection } from '../types';
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

export function buildToolSelectionsFromFunctions(
    functionIds: string[],
    availableFunctions: UserFunction[]
): ToolSelection[] {
    const functionIndex = buildFunctionIndex(availableFunctions);

    return functionIds.map((toolId) => {
        const matchingFunction = functionIndex.get(toolId);
        const resolvedToolId = matchingFunction?.toolId ?? toolId;
        return {
            toolId: resolvedToolId,
            versionRef: matchingFunction
                ? {
                    versionTag: matchingFunction.versionTag,
                    versionNumber: matchingFunction.version,
                    workspaceId: matchingFunction.workspaceContext?.workspaceId ?? null,
                }
                : undefined,
        };
    });
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
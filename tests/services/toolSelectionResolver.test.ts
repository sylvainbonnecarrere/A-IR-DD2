import {
    buildSelectableToolCatalog,
    buildToolSelectionsFromFunctions,
    deriveSelectedToolIds,
    resolveToolSelections,
} from '../../services/toolSelectionResolver';
import type { UserFunction } from '../../types/function.types';

const availableFunctions: UserFunction[] = [
    {
        _id: 'fn-1',
        toolId: 'tool-1',
        name: 'tool_alpha',
        description: 'Alpha tool',
        language: 'python',
        origin: 'custom',
        userId: 'user-1',
        workflowId: 'wf-1',
        inputSchema: {},
        outputSchema: {},
        codePath: 'tools/tool_alpha.py',
        resolvedCodePath: 'tools/tool_alpha.py',
        codePathRoot: 'workspace_source',
        codeInline: 'def run(args):\n    return args',
        dependencies: [],
        isEnabled: true,
        isReadonly: false,
        version: 3,
        versionTag: 'v3',
        tags: [],
        workspaceContext: {
            workspaceId: 'ws-1',
            logicalRoot: 'wf-1',
            runtimeRoots: {
                sourceRoot: 'source',
                manifestsRoot: 'manifests',
                buildRoot: 'build',
                outputRoot: 'output',
            },
            manifests: {},
            status: 'active',
            lastScanAt: null,
        },
        createdAt: '2026-03-19T00:00:00.000Z',
        updatedAt: '2026-03-19T00:00:00.000Z',
    },
];

describe('toolSelectionResolver', () => {
    it('builds versioned tool selections from selected function ids', () => {
        expect(buildToolSelectionsFromFunctions(['tool-1'], availableFunctions)).toEqual([
            {
                toolId: 'tool-1',
                versionRef: {
                    versionTag: 'v3',
                    versionNumber: 3,
                    workspaceId: 'ws-1',
                },
            },
        ]);
    });

    it('prefers canonical tool selections when deriving selected ids', () => {
        expect(deriveSelectedToolIds([{ toolId: 'tool-1' }], ['legacy-id'])).toEqual(['tool-1']);
        expect(deriveSelectedToolIds([], ['legacy-id'])).toEqual(['legacy-id']);
    });

    it('resolves canonical selections against the available function catalog', () => {
        expect(resolveToolSelections([{ toolId: 'tool-1' }, { toolId: 'missing-id' }], availableFunctions)).toEqual([
            {
                toolId: 'tool-1',
                versionTag: 'v3',
                versionNumber: 3,
                workspaceId: 'ws-1',
                function: availableFunctions[0],
                isMissing: false,
            },
            {
                toolId: 'missing-id',
                versionTag: undefined,
                versionNumber: undefined,
                workspaceId: null,
                function: undefined,
                isMissing: true,
            },
        ]);
    });

    it('builds a selectable target-first catalog with selection state and version metadata', () => {
        expect(buildSelectableToolCatalog(availableFunctions, ['tool-1'])).toEqual([
            {
                id: 'tool-1',
                name: 'tool_alpha',
                description: 'Alpha tool',
                language: 'python',
                origin: 'custom',
                tags: [],
                isEnabled: true,
                isReadonly: false,
                versionTag: 'v3',
                versionNumber: 3,
                workspaceId: 'ws-1',
                selected: true,
            },
        ]);
    });

    it('keeps legacy functionIds selectable during compatibility fallback', () => {
        expect(buildSelectableToolCatalog(availableFunctions, ['fn-1'])[0].selected).toBe(true);
    });
});
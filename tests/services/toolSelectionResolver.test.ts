import type { ToolSelection } from '../../types';
import type { UserFunction } from '../../types/function.types';
import {
    buildSelectableToolCatalog,
    buildToolSelectionFromFunction,
    buildToolSelectionsFromFunctions,
    deriveSelectedToolIds,
    normalizeAgentToolReferences,
    normalizeToolSelections,
    resolveToolSelections,
} from '../../services/toolSelectionResolver';

const createFunction = (overrides: Partial<UserFunction> = {}): UserFunction => ({
    _id: 'legacy-weather',
    toolId: 'tool.weather',
    name: 'Weather Tool',
    description: 'Returns weather data',
    language: 'python',
    origin: 'custom',
    userId: 'user-1',
    workflowId: 'wf-1',
    inputSchema: {},
    outputSchema: {},
    codePath: 'tools/weather.py',
    resolvedCodePath: 'tools/weather.py',
    codePathRoot: 'workspace_source',
    codeInline: 'def run(context, args):\n    return {"ok": True}',
    dependencies: [],
    isEnabled: true,
    isReadonly: false,
    version: 3,
    versionTag: 'v3',
    tags: ['weather'],
    createdAt: '2026-03-23T10:00:00.000Z',
    updatedAt: '2026-03-23T10:00:00.000Z',
    ...overrides,
});

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

describe('normalizeToolSelections', () => {
    it('builds a canonical tool selection for Phil sandbox runs from the loaded function read model', () => {
        expect(buildToolSelectionFromFunction(createFunction())).toEqual({
            toolId: 'tool.weather',
            versionRef: {
                versionTag: 'v3',
                versionNumber: 3,
                workspaceId: null,
            },
        });
    });

    it('upgrades legacy function ids into canonical tool selections', () => {
        const selections = normalizeToolSelections(undefined, ['legacy-weather'], [createFunction()]);

        expect(selections).toEqual([
            expect.objectContaining({
                toolId: 'tool.weather',
                versionRef: expect.objectContaining({
                    versionTag: 'v3',
                    versionNumber: 3,
                    workspaceId: null,
                }),
            }),
        ]);
    });

    it('preserves existing tool selections while backfilling missing version metadata', () => {
        const rawSelection: ToolSelection = {
            toolId: 'legacy-weather',
        };

        const selections = normalizeToolSelections([rawSelection], [], [createFunction()]);

        expect(selections).toEqual([
            expect.objectContaining({
                toolId: 'tool.weather',
                versionRef: expect.objectContaining({
                    versionTag: 'v3',
                    versionNumber: 3,
                }),
            }),
        ]);
    });
});

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

    it('treats toolSelections as the primary agent contract and derives functionIds from them', () => {
        expect(normalizeAgentToolReferences(
            [{ toolId: 'tool-1' }],
            ['legacy-stale-id'],
        )).toEqual({
            functionIds: ['tool-1'],
            toolSelections: [{ toolId: 'tool-1' }],
        });
    });

    it('backfills minimal toolSelections from legacy functionIds when canonical selections are missing', () => {
        expect(normalizeAgentToolReferences(undefined, ['tool-1', 'tool-1'])).toEqual({
            functionIds: ['tool-1'],
            toolSelections: [{ toolId: 'tool-1' }],
        });
    });
});
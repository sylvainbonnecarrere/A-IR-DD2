import apiClient from '../../utils/apiClient';
import { toolRepository } from '../../services/toolRepository';
import type {
    RuntimeCompatibilityContext,
    ToolDetailResponse,
    ToolTransitionRecord,
    ToolWorkspaceResponse,
} from '../../types/function.types';
import type { ToolSelection } from '../../types';

jest.mock('../../utils/apiClient', () => ({
    __esModule: true,
    default: {
        get: jest.fn(),
        post: jest.fn(),
        put: jest.fn(),
        patch: jest.fn(),
        delete: jest.fn(),
        getInstance: jest.fn(),
    },
}));

const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;

const runtimeCompatibility: RuntimeCompatibilityContext = {
    checkedAt: '2026-05-13T10:00:00.000Z',
    mode: 'docker-desktop',
    securityLevel: 'dev-only',
    executionReady: true,
    preferredRunner: 'docker_sandbox',
    warning: 'Docker Desktop is dev-only.',
    summary: 'Runtime ready in dev mode.',
};

const createToolRecord = (overrides: Partial<ToolTransitionRecord> = {}): ToolTransitionRecord => ({
    id: 'tool-weather',
    legacyFunctionId: 'legacy-weather',
    name: 'weather_tool',
    displayName: 'Weather Tool',
    description: 'Returns weather information.',
    runtime: 'typescript',
    origin: 'custom',
    scopeType: 'user',
    workflowId: 'wf-1',
    workspaceId: 'ws-1',
    status: 'ready',
    trustLevel: 'user_private',
    currentVersion: {
        versionTag: 'v3',
        versionNumber: 3,
        contentHash: 'hash-v3',
        sourceMode: 'path',
        sourcePath: 'tools/weather.ts',
        sourceInline: null,
        entrypoint: 'tools/weather.ts',
        createdAt: '2026-05-13T09:00:00.000Z',
        createdBy: 'user-1',
        buildStatus: 'built',
        validationStatus: 'valid',
    },
    versions: [],
    inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { weather: { type: 'string' } } },
    tags: ['weather'],
    dependencies: { npm: ['zod'] },
    policy: { networkMode: 'none' },
    isReadonly: false,
    isEnabled: true,
    compatibilityAliases: { functionId: 'legacy-weather' },
    workspaceContext: {
        workspaceId: 'ws-1',
        logicalRoot: 'wf-weather',
        runtimeRoots: {
            sourceRoot: 'src',
            manifestsRoot: 'manifests',
            buildRoot: 'build',
            outputRoot: 'output',
        },
        manifests: {
            packageJson: true,
            packageLockJson: true,
        },
        status: 'active',
        lastScanAt: '2026-05-13T09:10:00.000Z',
    },
    createdAt: '2026-05-13T09:00:00.000Z',
    updatedAt: '2026-05-13T09:30:00.000Z',
    ...overrides,
});

describe('toolRepository canonical contract', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('loads canonical /api/tools records and maps them into the frontend read model with runtime headers fallback', async () => {
        const tool = createToolRecord();
        const workspaceResponse: ToolWorkspaceResponse = {
            workspace: {
                id: 'ws-1',
                workflowId: 'wf-1',
                logicalRoot: 'wf-weather',
                runtimeRoots: {
                    sourceRoot: 'src',
                    manifestsRoot: 'manifests',
                    buildRoot: 'build',
                    outputRoot: 'output',
                },
                manifests: {
                    packageJson: true,
                    packageLockJson: true,
                },
                status: 'active',
                lastScanAt: '2026-05-13T09:10:00.000Z',
            },
            metrics: {
                toolCount: 1,
                runCount: 2,
            },
            runtimeCompatibility,
        };

        mockedApiClient.get
            .mockResolvedValueOnce({
                data: { items: [tool] },
                headers: {
                    'x-runtime-mode': 'docker-desktop',
                    'x-runtime-security-level': 'dev-only',
                    'x-runtime-execution-ready': 'true',
                    'x-runtime-preferred-runner': 'docker_sandbox',
                    'x-runtime-warning': 'Docker Desktop is dev-only.',
                },
            } as any)
            .mockResolvedValueOnce({ data: workspaceResponse } as any);

        const result = await toolRepository.loadPhilFunctions('wf-1');

        expect(mockedApiClient.get).toHaveBeenNthCalledWith(1, '/api/tools?workflowId=wf-1');
        expect(mockedApiClient.get).toHaveBeenNthCalledWith(2, '/api/workspaces/wf-1');
        expect(result.runtimeCompatibility).toEqual(expect.objectContaining({
            mode: 'docker-desktop',
            securityLevel: 'dev-only',
            executionReady: true,
            preferredRunner: 'docker_sandbox',
            warning: 'Docker Desktop is dev-only.',
        }));
        expect(result.workspace).toEqual(workspaceResponse.workspace);
        expect(result.functions).toEqual([
            expect.objectContaining({
                _id: 'legacy-weather',
                toolId: 'tool-weather',
                name: 'weather_tool',
                workflowId: 'wf-1',
                codePath: 'tools/weather.ts',
                codePathRoot: 'workspace_source',
                version: 3,
                versionTag: 'v3',
                dependencies: ['zod'],
            }),
        ]);
    });

    it('maps canonical /api/tools detail responses into the legacy-compatible frontend read model on create', async () => {
        const tool = createToolRecord();
        const response: ToolDetailResponse = {
            tool,
            runtimeCompatibility,
        };
        const payload = {
            name: 'weather_tool',
            description: 'Returns weather information.',
            language: 'typescript' as const,
            workflowId: 'wf-1',
            codeInline: 'export function run() { return { weather: "sunny" }; }',
        };

        mockedApiClient.post.mockResolvedValueOnce({ data: response } as any);

        const result = await toolRepository.createFunction(payload);

        expect(mockedApiClient.post).toHaveBeenCalledWith('/api/tools', payload);
        expect(result.data).toEqual(expect.objectContaining({
            _id: 'legacy-weather',
            toolId: 'tool-weather',
            version: 3,
            versionTag: 'v3',
            runtimeCompatibility,
        }));
    });

    it('sends only toolSelection to /api/sandbox/run when the canonical selection is available', async () => {
        const toolSelection: ToolSelection = {
            toolId: 'tool-weather',
            versionRef: {
                versionTag: 'v3',
                versionNumber: 3,
                workspaceId: null,
            },
        };

        mockedApiClient.post.mockResolvedValueOnce({ data: { success: true } } as any);

        await toolRepository.runInSandbox('legacy-weather', { city: 'Paris' }, toolSelection);

        expect(mockedApiClient.post).toHaveBeenCalledWith('/api/sandbox/run', {
            toolSelection,
            testArgs: { city: 'Paris' },
        });
    });

    it('keeps the legacy functionId fallback only when no canonical selection is available', async () => {
        mockedApiClient.post.mockResolvedValueOnce({ data: { success: true } } as any);

        await toolRepository.runInSandbox('legacy-weather', { city: 'Paris' });

        expect(mockedApiClient.post).toHaveBeenCalledWith('/api/sandbox/run', {
            functionId: 'legacy-weather',
            testArgs: { city: 'Paris' },
        });
    });
});
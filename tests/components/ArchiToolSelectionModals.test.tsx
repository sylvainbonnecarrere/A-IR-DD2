import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentFormModal } from '../../components/modals/AgentFormModal';
import { AgentConfigurationModal } from '../../components/modals/AgentConfigurationModal';
import { LLMCapability, LLMProvider, RobotId, type LLMConfig } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import type { UserFunction } from '../../types/function.types';

let runtimeStoreState: Record<string, unknown>;
let functionStoreState: { functions: UserFunction[] };
let designStoreState: Record<string, unknown>;
const mockSetConfigModalInstanceId = jest.fn();
const mockUpdateInstanceConfig = jest.fn();
const mockUpdateAgentInstance = jest.fn();
const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const originalFetch = global.fetch;

jest.mock('../../hooks/useLocalization', () => ({
    useLocalization: jest.fn(() => ({
        t: (key: string) => key,
    })),
}));

jest.mock('../../hooks/useAuth', () => ({
    useAuth: jest.fn(() => ({
        user: null,
        accessToken: null,
    })),
}));

jest.mock('../../hooks/useLMStudioDetection', () => ({
    useLMStudioDetection: jest.fn(() => ({
        detection: null,
        isDetecting: false,
        redetect: jest.fn(),
    })),
}));

jest.mock('../../contexts/NotificationContext', () => ({
    useNotifications: jest.fn(() => ({
        addNotification: jest.fn(),
    })),
}));

jest.mock('../../stores/useRuntimeStore', () => ({
    useRuntimeStore: jest.fn((selector?: (state: Record<string, unknown>) => unknown) => (
        selector ? selector(runtimeStoreState) : runtimeStoreState
    )),
}));

jest.mock('../../stores/useFunctionStore', () => ({
    useFunctionStore: jest.fn((selector?: (state: { functions: UserFunction[] }) => unknown) => (
        selector ? selector(functionStoreState) : functionStoreState
    )),
}));

jest.mock('../../stores/useDesignStore', () => {
    const useDesignStore = jest.fn((selector?: (state: Record<string, unknown>) => unknown) => (
        selector ? selector(designStoreState) : designStoreState
    ));

    Object.assign(useDesignStore, {
        getState: jest.fn(() => designStoreState),
    });

    return { useDesignStore };
});

jest.mock('../../components/FunctionSelector', () => ({
    FunctionSelector: ({
        onChange,
        onChangeToolSelections,
        readOnly,
        selectedIds = [],
        selectedToolSelections = [],
    }: {
        onChange?: (ids: string[]) => void;
        onChangeToolSelections?: (toolSelections: Array<{ toolId: string }>) => void;
        readOnly?: boolean;
        selectedIds?: string[];
        selectedToolSelections?: Array<{ toolId: string }>;
    }) => (
        <div>
            <div data-testid="function-selector-state">{(selectedToolSelections.length > 0 ? selectedToolSelections.map((selection) => selection.toolId) : selectedIds).join(',')}</div>
            {!readOnly && (
                <button
                    type="button"
                    onClick={() => {
                        onChange?.(['tool.weather']);
                        onChangeToolSelections?.([{ toolId: 'tool.weather' }]);
                    }}
                >
                    select-canonical-tool
                </button>
            )}
        </div>
    ),
}));

const llmConfigs: LLMConfig[] = [
    {
        provider: LLMProvider.Gemini,
        enabled: true,
        apiKey: 'test-key',
        capabilities: {
            [LLMCapability.Chat]: true,
            [LLMCapability.FunctionCalling]: true,
        },
    },
];

const emptyLocalProfiles: [] = [];

const availableFunction: UserFunction = {
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
    workspaceContext: {
        workspaceId: 'ws-1',
        logicalRoot: 'wf-1',
        runtimeRoots: {
            sourceRoot: 'source',
            manifestsRoot: 'manifests',
            buildRoot: 'build',
            outputRoot: 'output',
        },
        manifests: {
            requirementsTxt: true,
        },
        status: 'active',
        lastScanAt: '2026-03-23T10:00:00.000Z',
    },
    createdAt: '2026-03-23T10:00:00.000Z',
    updatedAt: '2026-03-23T10:00:00.000Z',
};

describe('Archi tool selection modals', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        global.fetch = originalFetch;
        mockUseAuth.mockReturnValue({
            user: null,
            accessToken: null,
            isAuthenticated: false,
        } as ReturnType<typeof useAuth>);
        runtimeStoreState = {
            llmConfigs: [],
            localLLMProfiles: [],
            configModalInstanceId: 'instance-1',
            setConfigModalInstanceId: mockSetConfigModalInstanceId,
        };
        functionStoreState = {
            functions: [availableFunction],
        };

        const resolvedInstance = {
            instance: {
                id: 'instance-db-1',
                name: 'Agent instance',
                prototypeId: 'agent-1',
                position: { x: 10, y: 20 },
                configuration_json: {
                    role: 'Analyste',
                    model: 'gemini-2.5-flash',
                    llmProvider: LLMProvider.Gemini,
                    systemPrompt: 'Analyse les donnees',
                    capabilities: [LLMCapability.Chat, LLMCapability.ImageGeneration],
                    tools: [
                        {
                            name: 'provider_web_search',
                            description: 'Searches the web through the provider tool API.',
                            parameters: { type: 'object' },
                        },
                    ],
                    logs: [],
                    errors: [],
                    tasks: [],
                    links: [],
                },
                persistenceConfig: undefined,
            },
            prototype: {
                id: 'agent-1',
                name: 'Prototype meteo',
                role: 'Analyste',
                model: 'gemini-2.5-flash',
                llmProvider: LLMProvider.Gemini,
                systemPrompt: 'Analyse les donnees',
                capabilities: [LLMCapability.Chat, LLMCapability.ImageGeneration],
                tools: [
                    {
                        name: 'provider_web_search',
                        description: 'Searches the web through the provider tool API.',
                        parameters: { type: 'object' },
                    },
                ],
                functionIds: ['legacy-weather'],
                toolSelections: [{ toolId: 'tool.weather' }],
            },
        };

        designStoreState = {
            currentRobotId: RobotId.Archi,
            getResolvedInstance: jest.fn(() => resolvedInstance),
            updateInstanceConfig: mockUpdateInstanceConfig,
            updateAgentInstance: mockUpdateAgentInstance,
        };
    });

    afterAll(() => {
        global.fetch = originalFetch;
    });

    it('saves canonical tool selections from AgentFormModal', () => {
        const onSave = jest.fn();

        render(
            <AgentFormModal
                onClose={jest.fn()}
                onSave={onSave}
                llmConfigs={llmConfigs}
                existingAgent={null}
                localLLMProfiles={emptyLocalProfiles}
            />
        );

        fireEvent.change(screen.getByLabelText('agentForm_nameLabel'), {
            target: { value: 'Prototype Meteo' },
        });
        fireEvent.click(screen.getByText('agentForm_tab_functions'));
        fireEvent.click(screen.getByText('select-canonical-tool'));
        fireEvent.click(screen.getByText('agentForm_createButton'));

        expect(onSave).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'Prototype Meteo',
                functionIds: ['tool.weather'],
                toolSelections: [
                    {
                        toolId: 'tool.weather',
                        versionRef: {
                            versionTag: 'v3',
                            versionNumber: 3,
                            workspaceId: 'ws-1',
                        },
                    },
                ],
                creator_id: RobotId.Archi,
            }),
            undefined
        );
    });

    it('persists per-threshold activation flags from AgentFormModal history settings', () => {
        const onSave = jest.fn();

        render(
            <AgentFormModal
                onClose={jest.fn()}
                onSave={onSave}
                llmConfigs={llmConfigs}
                existingAgent={null}
                localLLMProfiles={emptyLocalProfiles}
            />
        );

        fireEvent.change(screen.getByLabelText('agentForm_nameLabel'), {
            target: { value: 'Prototype Memoire' },
        });
        fireEvent.click(screen.getByText('agentForm_tab_history'));
        fireEvent.click(screen.getByLabelText('agentForm_history_enableLabel'));
        fireEvent.click(screen.getByText('agentForm_createButton'));

        expect(onSave).toHaveBeenCalledWith(
            expect.objectContaining({
                historyConfig: expect.objectContaining({
                    enabled: true,
                    limits: expect.objectContaining({
                        sentence: 30,
                        message: 6,
                    }),
                    enabledLimits: expect.objectContaining({
                        char: false,
                        word: false,
                        token: false,
                        sentence: true,
                        message: true,
                    }),
                }),
            }),
            undefined,
        );
    });

    it('saves individual threshold toggles from AgentFormModal history settings', () => {
        const onSave = jest.fn();

        render(
            <AgentFormModal
                onClose={jest.fn()}
                onSave={onSave}
                llmConfigs={llmConfigs}
                existingAgent={null}
                localLLMProfiles={emptyLocalProfiles}
            />
        );

        fireEvent.change(screen.getByLabelText('agentForm_nameLabel'), {
            target: { value: 'Prototype Memoire Affine' },
        });
        fireEvent.click(screen.getByText('agentForm_tab_history'));
        fireEvent.click(screen.getByLabelText('agentForm_history_enableLabel'));
        fireEvent.click(screen.getByLabelText('history_limit_active history_limit_message'));
        fireEvent.click(screen.getByText('agentForm_createButton'));

        expect(onSave).toHaveBeenCalledWith(
            expect.objectContaining({
                historyConfig: expect.objectContaining({
                    enabledLimits: expect.objectContaining({
                        sentence: true,
                        message: false,
                    }),
                }),
            }),
            undefined,
        );
    });

    it('keeps canonical tool selections aligned with the prototype when the application block stays unchanged', async () => {
        render(<AgentConfigurationModal llmConfigs={llmConfigs} />);

        fireEvent.click(screen.getByText('agentConfig_tab_functions'));
        fireEvent.click(screen.getByText('select-canonical-tool'));
        fireEvent.click(screen.getByText('agentConfig_saveButton'));

        await waitFor(() => {
            expect(mockUpdateInstanceConfig).toHaveBeenCalledWith(
                'instance-1',
                expect.objectContaining({
                    functionInheritance: {
                        inheritFromPrototype: true,
                        overrideFunctionIds: [],
                        overrideToolSelections: [],
                    },
                    toolSelections: [
                        {
                            toolId: 'tool.weather',
                            versionRef: {
                                versionTag: 'v3',
                                versionNumber: 3,
                                workspaceId: 'ws-1',
                            },
                        },
                    ],
                })
            );
            expect(mockSetConfigModalInstanceId).toHaveBeenCalledWith(null);
        });
    });

    it('renders explicit application-native and provider-cloud families in AgentConfigurationModal', () => {
        render(<AgentConfigurationModal llmConfigs={llmConfigs} />);

        fireEvent.click(screen.getByText('agentConfig_tab_functions'));

        expect(screen.getByText('Fonctions natives/custom application')).toBeInTheDocument();
        expect(screen.getByText('Fonctions provider/cloud')).toBeInTheDocument();
        expect(screen.queryByLabelText('Hériter les fonctions applicatives du prototype')).not.toBeInTheDocument();
        expect(screen.getByText('Function Calling')).toBeInTheDocument();
        expect(screen.getByText('File Analysis')).toBeInTheDocument();
        expect(screen.getByText('URL Analysis')).toBeInTheDocument();
        expect(screen.getByText('Web Search')).toBeInTheDocument();
        expect(screen.getByText('Image Generation')).toBeInTheDocument();
        expect(screen.getByText('Image Modification')).toBeInTheDocument();
        expect(screen.getByText('Output Formatting')).toBeInTheDocument();
        expect(screen.getByText('Video Generation')).toBeInTheDocument();
        expect(screen.getByText('Maps Grounding')).toBeInTheDocument();
        expect(screen.queryByText('provider_web_search')).not.toBeInTheDocument();
        expect(screen.queryByText('Web Search Grounding')).not.toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: 'Image Generation' })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('checkbox', { name: 'Function Calling' })).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByRole('checkbox', { name: 'File Analysis' })).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByRole('checkbox', { name: 'Web Search' })).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByRole('checkbox', { name: 'Image Modification' })).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByRole('checkbox', { name: 'Output Formatting' })).toHaveAttribute('aria-checked', 'false');
    });

    it('allows adding or removing provider functions from the full Gemini 2.5 Flash catalog', async () => {
        render(<AgentConfigurationModal llmConfigs={llmConfigs} />);

        fireEvent.click(screen.getByText('agentConfig_tab_functions'));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Image Generation' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Image Modification' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Function Calling' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Output Formatting' }));
        fireEvent.click(screen.getByText('agentConfig_saveButton'));

        await waitFor(() => {
            expect(mockUpdateInstanceConfig).toHaveBeenCalledWith(
                'instance-1',
                expect.objectContaining({
                    capabilities: expect.arrayContaining([
                        LLMCapability.Chat,
                        LLMCapability.FunctionCalling,
                        LLMCapability.ImageModification,
                        LLMCapability.OutputFormatting,
                    ]),
                }),
            );
        });

        const savedConfig = mockUpdateInstanceConfig.mock.calls.at(-1)?.[1];
        expect(savedConfig.capabilities).not.toContain(LLMCapability.ImageGeneration);
    });

    it('falls back to prototype LLM-native functions when the instance does not override capabilities', async () => {
        designStoreState.getResolvedInstance = jest.fn(() => ({
            instance: {
                id: 'instance-db-1',
                name: 'Agent instance',
                prototypeId: 'agent-1',
                position: { x: 10, y: 20 },
                configuration_json: {
                    role: 'Analyste',
                    model: 'gemini-2.5-flash',
                    llmProvider: LLMProvider.Gemini,
                    systemPrompt: 'Analyse les donnees',
                    tools: [
                        {
                            name: 'provider_web_search',
                            description: 'Searches the web through the provider tool API.',
                            parameters: { type: 'object' },
                        },
                    ],
                    logs: [],
                    errors: [],
                    tasks: [],
                    links: [],
                },
                persistenceConfig: undefined,
            },
            prototype: {
                id: 'agent-1',
                name: 'Prototype meteo',
                role: 'Analyste',
                model: 'gemini-2.5-flash',
                llmProvider: LLMProvider.Gemini,
                systemPrompt: 'Analyse les donnees',
                capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling, LLMCapability.WebFetchTool],
                tools: [
                    {
                        name: 'provider_web_search',
                        description: 'Searches the web through the provider tool API.',
                        parameters: { type: 'object' },
                    },
                ],
                functionIds: ['legacy-weather'],
                toolSelections: [{ toolId: 'tool.weather' }],
            },
        }));

        render(<AgentConfigurationModal llmConfigs={llmConfigs} />);

        fireEvent.click(screen.getByText('agentConfig_tab_functions'));

        await waitFor(() => {
            expect(screen.getByText('Web Fetch')).toBeInTheDocument();
            expect(screen.queryByText('provider_web_search')).not.toBeInTheDocument();
        });
    });

    it('shows only sentence and message as active defaults for legacy instance history configs without enabledLimits', async () => {
        designStoreState.getResolvedInstance = jest.fn(() => ({
            instance: {
                id: 'instance-db-1',
                name: 'Agent instance',
                prototypeId: 'agent-1',
                position: { x: 10, y: 20 },
                configuration_json: {
                    role: 'Analyste',
                    model: 'gemini-2.5-flash',
                    llmProvider: LLMProvider.Gemini,
                    systemPrompt: 'Analyse les donnees',
                    capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling],
                    tools: [],
                    historyConfig: {
                        enabled: true,
                        llmProvider: LLMProvider.Gemini,
                        model: 'gemini-2.5-flash',
                        role: 'Archiviste',
                        systemPrompt: 'Résumé',
                        limits: {
                            char: 5000,
                            word: 1000,
                            token: 800,
                            sentence: 30,
                            message: 6,
                        },
                    },
                    logs: [],
                    errors: [],
                    tasks: [],
                    links: [],
                },
                persistenceConfig: undefined,
            },
            prototype: {
                id: 'agent-1',
                name: 'Prototype meteo',
                role: 'Analyste',
                model: 'gemini-2.5-flash',
                llmProvider: LLMProvider.Gemini,
                systemPrompt: 'Analyse les donnees',
                capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling],
                tools: [],
                functionIds: ['legacy-weather'],
                toolSelections: [{ toolId: 'tool.weather' }],
            },
        }));

        render(<AgentConfigurationModal llmConfigs={llmConfigs} />);

        fireEvent.click(screen.getByText('agentConfig_tab_history'));

        await waitFor(() => {
            expect(screen.getByLabelText('history_limit_active history_limit_char')).not.toBeChecked();
            expect(screen.getByLabelText('history_limit_active history_limit_word')).not.toBeChecked();
            expect(screen.getByLabelText('history_limit_active history_limit_token')).not.toBeChecked();
            expect(screen.getByLabelText('history_limit_active history_limit_sentence')).toBeChecked();
            expect(screen.getByLabelText('history_limit_active history_limit_message')).toBeChecked();
        });
    });

    it('sanitizes persistenceConfig before syncing an instance to the backend', async () => {
        const fetchMock = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                configuration_json: {
                    role: 'Analyste',
                    model: 'gemini-2.5-flash',
                    llmProvider: LLMProvider.Gemini,
                },
            }),
        });
        global.fetch = fetchMock as unknown as typeof fetch;
        mockUseAuth.mockReturnValue({
            user: { id: 'user-1' },
            accessToken: 'token-123',
            isAuthenticated: true,
        } as ReturnType<typeof useAuth>);

        designStoreState.getResolvedInstance = jest.fn(() => ({
            instance: {
                id: 'instance-db-1',
                name: 'Agent instance',
                prototypeId: 'agent-1',
                position: { x: 10, y: 20 },
                configuration_json: {
                    role: 'Analyste',
                    model: 'gemini-2.5-flash',
                    llmProvider: LLMProvider.Gemini,
                    systemPrompt: 'Analyse les donnees',
                    capabilities: [LLMCapability.Chat],
                    logs: [],
                    errors: [],
                    tasks: [],
                    links: [],
                },
                persistenceConfig: {
                    saveChat: true,
                    saveErrors: true,
                    saveHistorySummary: false,
                    saveLinks: false,
                    saveTasks: false,
                    saveMedia: true,
                    mediaStorage: 'cloud',
                    allowWorkspaceWrite: true,
                    cloudConnectionProfileId: null,
                    cloudStorageConfig: {
                        provider: 's3',
                        bucketName: 'legacy-bucket',
                    },
                    retentionDays: null,
                },
            },
            prototype: {
                id: 'agent-1',
                name: 'Prototype meteo',
                role: 'Analyste',
                model: 'gemini-2.5-flash',
                llmProvider: LLMProvider.Gemini,
                systemPrompt: 'Analyse les donnees',
                capabilities: [LLMCapability.Chat],
                tools: [],
                functionIds: ['legacy-weather'],
                toolSelections: [{ toolId: 'tool.weather' }],
            },
        }));

        render(<AgentConfigurationModal llmConfigs={llmConfigs} />);

        fireEvent.change(screen.getByDisplayValue('Agent instance'), {
            target: { value: 'Agent instance v2' },
        });
        fireEvent.click(screen.getByText('agentConfig_saveButton'));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

        const [, options] = fetchMock.mock.calls[0];
        const payload = JSON.parse(options.body as string);

        expect(payload.persistenceConfig).toEqual(expect.objectContaining({
            saveMedia: true,
            mediaStorage: 'cloud',
            allowWorkspaceWrite: true,
        }));
        expect(payload.persistenceConfig.cloudConnectionProfileId).toBeUndefined();
        expect(payload.persistenceConfig.cloudStorageConfig).toBeUndefined();
        expect(payload.persistenceConfig.retentionDays).toBeUndefined();
    });
});
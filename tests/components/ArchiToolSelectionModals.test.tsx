import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentFormModal } from '../../components/modals/AgentFormModal';
import { AgentConfigurationModal } from '../../components/modals/AgentConfigurationModal';
import { LLMCapability, LLMProvider, RobotId, type LLMConfig } from '../../types';
import type { UserFunction } from '../../types/function.types';

let runtimeStoreState: Record<string, unknown>;
let functionStoreState: { functions: UserFunction[] };
let designStoreState: Record<string, unknown>;
const mockSetConfigModalInstanceId = jest.fn();
const mockUpdateInstanceConfig = jest.fn();
const mockUpdateAgentInstance = jest.fn();

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

jest.mock('../../stores/useDesignStore', () => ({
    useDesignStore: jest.fn((selector?: (state: Record<string, unknown>) => unknown) => (
        selector ? selector(designStoreState) : designStoreState
    )),
}));

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
                    capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling],
                    tools: [],
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
        };

        designStoreState = {
            getResolvedInstance: jest.fn(() => resolvedInstance),
            updateInstanceConfig: mockUpdateInstanceConfig,
            updateAgentInstance: mockUpdateAgentInstance,
        };
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

    it('saves canonical override tool selections from AgentConfigurationModal', async () => {
        render(<AgentConfigurationModal llmConfigs={llmConfigs} />);

        fireEvent.click(screen.getByText('agentConfig_tab_functions'));
        fireEvent.click(screen.getByLabelText('Hériter les fonctions du prototype'));
        fireEvent.click(screen.getByText('select-canonical-tool'));
        fireEvent.click(screen.getByText('agentConfig_saveButton'));

        await waitFor(() => {
            expect(mockUpdateInstanceConfig).toHaveBeenCalledWith(
                'instance-1',
                expect.objectContaining({
                    functionInheritance: {
                        inheritFromPrototype: false,
                        overrideFunctionIds: ['tool.weather'],
                        overrideToolSelections: [
                            {
                                toolId: 'tool.weather',
                                versionRef: {
                                    versionTag: 'v3',
                                    versionNumber: 3,
                                    workspaceId: 'ws-1',
                                },
                            },
                        ],
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
});
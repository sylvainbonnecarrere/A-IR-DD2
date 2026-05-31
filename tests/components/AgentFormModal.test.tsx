import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentFormModal } from '../../components/modals/AgentFormModal';
import { LLMCapability, LLMProvider, RobotId, type Agent, type LLMConfig } from '../../types';
import type { UserFunction } from '../../types/function.types';

jest.mock('../../hooks/useLocalization', () => ({
    useLocalization: jest.fn(() => ({
        t: (key: string, fallbackOrParams?: string | Record<string, string | number>, params?: Record<string, string | number>) => {
            if (typeof fallbackOrParams === 'string') {
                return Object.entries(params ?? {}).reduce(
                    (value, [paramKey, paramValue]) => value.replace(`{${paramKey}}`, String(paramValue)),
                    fallbackOrParams,
                );
            }

            return key;
        },
    })),
}));

jest.mock('../../hooks/useAuth', () => ({
    useAuth: jest.fn(() => ({
        user: { id: 'user-1' },
        accessToken: 'token-1',
    })),
}));

jest.mock('../../hooks/useLMStudioDetection', () => ({
    useLMStudioDetection: jest.fn(() => ({
        detection: null,
        isDetecting: false,
        redetect: jest.fn(),
    })),
}));

const runtimeStoreState = {
    llmConfigs: [] as LLMConfig[],
    localLLMProfiles: [],
};

jest.mock('../../stores/useRuntimeStore', () => ({
    useRuntimeStore: jest.fn((selector: (state: typeof runtimeStoreState) => unknown) => selector(runtimeStoreState)),
}));

const functionStoreState = {
    functions: [] as UserFunction[],
    isLoading: false,
    loadFunctions: jest.fn(),
    runtimeCompatibility: undefined,
};

jest.mock('../../stores/useFunctionStore', () => ({
    useFunctionStore: jest.fn((selector?: (state: typeof functionStoreState) => unknown) => (
        selector ? selector(functionStoreState) : functionStoreState
    )),
}));

const llmConfigs: LLMConfig[] = [
    {
        provider: LLMProvider.OpenAI,
        enabled: true,
        apiKey: 'sk-test',
        capabilities: {
            [LLMCapability.Chat]: true,
            [LLMCapability.FunctionCalling]: true,
        },
    },
];

const localLLMProfiles: [] = [];

const availableFunction: UserFunction = {
    _id: 'legacy-weather',
    toolId: 'tool-weather',
    name: 'weather_tool',
    description: 'Returns weather information.',
    language: 'typescript',
    origin: 'custom',
    userId: 'user-1',
    workflowId: 'wf-1',
    inputSchema: {},
    outputSchema: {},
    codePath: 'tools/weather.ts',
    resolvedCodePath: 'tools/weather.ts',
    codePathRoot: 'workspace_source',
    codeInline: 'export function run() { return { ok: true }; }',
    dependencies: [],
    isEnabled: true,
    isReadonly: false,
    version: 3,
    versionTag: 'v3',
    tags: ['weather'],
    createdAt: '2026-05-13T09:00:00.000Z',
    updatedAt: '2026-05-13T09:30:00.000Z',
};

const existingAgent: Agent = {
    id: 'agent-1',
    name: 'Weather Agent',
    role: 'Assistant meteo',
    systemPrompt: 'Use tools when needed.',
    llmProvider: LLMProvider.OpenAI,
    model: 'gpt-4o-mini',
    capabilities: [LLMCapability.FunctionCalling, LLMCapability.ImageGeneration],
    tools: [
        {
            name: 'provider_web_search',
            description: 'Searches the web through the provider tool API.',
            parameters: { type: 'object' },
        },
    ],
    functionIds: ['legacy-weather'],
    creator_id: RobotId.Archi,
    created_at: '2026-05-13T09:00:00.000Z',
    updated_at: '2026-05-13T09:30:00.000Z',
};

describe('AgentFormModal canonical tool selection contract', () => {
    beforeEach(() => {
        functionStoreState.functions = [availableFunction];
    });

    it('saves canonical toolSelections and derives functionIds from the normalized tool ids', async () => {
        const onSave = jest.fn();

        render(
            <AgentFormModal
                onClose={jest.fn()}
                onSave={onSave}
                llmConfigs={llmConfigs}
                existingAgent={existingAgent}
                localLLMProfiles={localLLMProfiles}
            />,
        );

        await waitFor(() => {
            expect(screen.getByDisplayValue('Weather Agent')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'agentForm_saveButton' }));

        expect(onSave).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'Weather Agent',
                capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling, LLMCapability.ImageGeneration],
                functionIds: ['tool-weather'],
                toolSelections: [
                    expect.objectContaining({
                        toolId: 'tool-weather',
                        versionRef: expect.objectContaining({
                            versionTag: 'v3',
                            versionNumber: 3,
                        }),
                    }),
                ],
            }),
            'agent-1',
        );
    });

    it('renders only the application functions family in the prototype functions tab', async () => {
        const onSave = jest.fn();

        render(
            <AgentFormModal
                onClose={jest.fn()}
                onSave={onSave}
                llmConfigs={llmConfigs}
                existingAgent={existingAgent}
                localLLMProfiles={localLLMProfiles}
            />,
        );

        await waitFor(() => {
            expect(screen.getByDisplayValue('Weather Agent')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('agentForm_tab_functions'));

        expect(screen.getByText('Fonctions natives/custom application')).toBeInTheDocument();
        expect(screen.queryByText('Fonctions provider/cloud')).not.toBeInTheDocument();
        expect(screen.queryByText('Function Calling')).not.toBeInTheDocument();
        expect(screen.queryByText('Image Generation')).not.toBeInTheDocument();
        expect(screen.queryByText('provider_web_search')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Nom provider/cloud')).not.toBeInTheDocument();
    });
});
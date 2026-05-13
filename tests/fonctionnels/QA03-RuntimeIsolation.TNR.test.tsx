import React from 'react';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAgentChat } from '../../hooks/useAgentChat';
import { useRuntimeStore } from '../../stores/useRuntimeStore';
import {
    Agent,
    ChatMessage,
    LLMCapability,
    LLMConfig,
    LLMProvider,
    LocalLLMProfile,
    RobotId,
    WorkflowNode,
} from '../../types';
import { ImageGenerationPanel } from '../../components/panels/ImageGenerationPanel';
import { ImageModificationPanel } from '../../components/panels/ImageModificationPanel';
import { MapsGroundingConfigPanel } from '../../components/panels/MapsGroundingConfigPanel';

const mockCreateAdapter = jest.fn();
const mockRunAgentLoop = jest.fn();

jest.mock('../../services/llmService', () => ({
    generateContentStream: jest.fn(),
    generateContent: jest.fn(),
    generateImage: jest.fn(),
    editImage: jest.fn(),
    generateContentWithMaps: jest.fn(),
}));

jest.mock('../../utils/toolExecutor', () => ({
    executeTool: jest.fn(),
}));

jest.mock('../../services/adapters/AdapterFactory', () => ({
    createAdapter: (...args: unknown[]) => mockCreateAdapter(...args),
}));

jest.mock('../../services/llm/AgentLoop', () => ({
    runAgentLoop: (...args: unknown[]) => mockRunAgentLoop(...args),
}));

jest.mock('../../hooks/useLocalization', () => ({
    useLocalization: () => ({
        t: (key: string) => key,
    }),
}));

jest.mock('../../contexts/AuthContext', () => ({
    useAuth: jest.fn(() => ({
        accessToken: 'token-123',
        isAuthenticated: true,
    })),
}));

jest.mock('../../stores/useDesignStore', () => {
    const actual = jest.requireActual('../../stores/useDesignStore');

    return {
        ...actual,
        useDesignStore: jest.fn((selector?: (state: Record<string, unknown>) => unknown) => {
            const state = {
                agentInstances: [
                    { id: 'instance-alpha', workflowId: 'wf-1' },
                    { id: 'instance-beta', workflowId: 'wf-1' },
                    { id: 'instance-multi-turn', workflowId: 'wf-1' },
                    { id: 'instance-follow-up', workflowId: 'wf-1' },
                ],
            };
            return selector ? selector(state) : state;
        }),
    };
});

import * as llmService from '../../services/llmService';
import { executeTool } from '../../utils/toolExecutor';

const mockedGenerateContentStream = llmService.generateContentStream as jest.Mock;
const mockedGenerateContent = llmService.generateContent as jest.Mock;
const mockedGenerateImage = llmService.generateImage as jest.Mock;
const mockedEditImage = llmService.editImage as jest.Mock;
const mockedGenerateContentWithMaps = llmService.generateContentWithMaps as jest.Mock;
const mockedExecuteTool = executeTool as jest.Mock;

const LOCAL_RUNTIME_CONFIG: LLMConfig = {
    provider: LLMProvider.LMStudio,
    enabled: true,
    localEndpoint: 'http://shared-default:3928',
    capabilities: {
        [LLMCapability.Chat]: true,
        [LLMCapability.FunctionCalling]: true,
        [LLMCapability.ImageGeneration]: true,
        [LLMCapability.ImageModification]: true,
    },
};

const CLOUD_RUNTIME_CONFIG: LLMConfig = {
    provider: LLMProvider.Gemini,
    enabled: true,
    apiKey: 'gemini-test-key-placeholder',
    capabilities: {
        [LLMCapability.Chat]: true,
        [LLMCapability.MapsGrounding]: true,
    },
};

const LOCAL_PROFILES: LocalLLMProfile[] = [
    {
        id: 'profile-alpha',
        name: 'Alpha',
        endpoint: 'http://localhost:11434',
        enabled: true,
        capabilities: { [LLMCapability.Chat]: true },
    },
    {
        id: 'profile-beta',
        name: 'Beta',
        endpoint: 'http://localhost:1234',
        enabled: true,
        capabilities: { [LLMCapability.Chat]: true },
    },
];

function createAgent(overrides: Partial<Agent> = {}): Agent {
    return {
        id: overrides.id || 'agent-1',
        name: overrides.name || 'Runtime Agent',
        role: 'assistant',
        systemPrompt: 'System prompt',
        llmProvider: overrides.llmProvider || LLMProvider.LMStudio,
        model: overrides.model || 'local-model',
        capabilities: overrides.capabilities || [LLMCapability.Chat],
        tools: overrides.tools || [],
        creator_id: RobotId.Archi,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...overrides,
    };
}

function createStream(chunks: any[]) {
    return (async function* () {
        for (const chunk of chunks) {
            yield chunk;
        }
    })();
}

describe('QA-03 TNR - Runtime isolation multi-agents et panels', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        useRuntimeStore.getState().resetAll();
        useRuntimeStore.getState().updateLocalLLMProfiles(LOCAL_PROFILES);
        useRuntimeStore.getState().updateLLMConfigs([LOCAL_RUNTIME_CONFIG, CLOUD_RUNTIME_CONFIG]);
        mockCreateAdapter.mockImplementation((_provider, config, model, authToken) => ({
            provider: (config as LLMConfig | null)?.provider,
            endpoint: (config as LLMConfig | null)?.localEndpoint,
            model,
            authToken,
        }));
        mockRunAgentLoop.mockResolvedValue({
            finalResponse: 'local response',
            toolCallLog: [],
            iterations: 1,
            finishReason: 'stop',
        });
    });

    it('isole deux agents locaux du meme provider avec des endpoints differents', async () => {
        const firstAgent = createAgent({
            id: 'agent-alpha',
            name: 'Alpha Agent',
            localLLMProfileId: 'profile-alpha',
        });
        const secondAgent = createAgent({
            id: 'agent-beta',
            name: 'Beta Agent',
            localLLMProfileId: 'profile-beta',
        });

        const firstHook = renderHook(() => useAgentChat({
            nodeId: 'node-alpha',
            agent: firstAgent,
            llmConfigs: [LOCAL_RUNTIME_CONFIG],
            t: (key: string) => key,
            instanceId: 'instance-alpha',
        }));

        await act(async () => {
            await firstHook.result.current.handleSendMessage('hello alpha', null);
        });

        const secondHook = renderHook(() => useAgentChat({
            nodeId: 'node-beta',
            agent: secondAgent,
            llmConfigs: [LOCAL_RUNTIME_CONFIG],
            t: (key: string) => key,
            instanceId: 'instance-beta',
        }));

        await act(async () => {
            await secondHook.result.current.handleSendMessage('hello beta', null);
        });

        expect(mockCreateAdapter).toHaveBeenCalledTimes(2);
        expect(mockCreateAdapter.mock.calls[0][1]).toEqual(expect.objectContaining({ localEndpoint: 'http://localhost:11434' }));
        expect(mockCreateAdapter.mock.calls[1][1]).toEqual(expect.objectContaining({ localEndpoint: 'http://localhost:1234' }));
        expect(mockRunAgentLoop).toHaveBeenCalledTimes(2);
        expect(mockRunAgentLoop.mock.calls[0][0]).toEqual(expect.objectContaining({ endpoint: 'http://localhost:11434' }));
        expect(mockRunAgentLoop.mock.calls[1][0]).toEqual(expect.objectContaining({ endpoint: 'http://localhost:1234' }));
    });

    it('conserve la meme identite runtime sur plusieurs tours consecutifs', async () => {
        const agent = createAgent({
            id: 'agent-multi-turn',
            localLLMProfileId: 'profile-beta',
            historyConfig: {
                enabled: true,
                llmProvider: LLMProvider.LMStudio,
                model: 'local-model',
                role: 'summarizer',
                systemPrompt: 'Keep context',
                limits: {
                    char: 10000,
                    word: 10000,
                    token: 10000,
                    sentence: 10000,
                    message: 10000,
                },
            },
        });

        const { result } = renderHook(() => useAgentChat({
            nodeId: 'node-multi-turn',
            agent,
            llmConfigs: [LOCAL_RUNTIME_CONFIG],
            t: (key: string) => key,
            instanceId: 'instance-multi-turn',
        }));

        await act(async () => {
            await result.current.handleSendMessage('first turn', null);
        });

        await act(async () => {
            await result.current.handleSendMessage('second turn', null);
        });

        expect(mockCreateAdapter).toHaveBeenCalledTimes(2);
        expect(mockCreateAdapter.mock.calls[0][1]).toEqual(expect.objectContaining({ localEndpoint: 'http://localhost:1234' }));
        expect(mockCreateAdapter.mock.calls[1][1]).toEqual(expect.objectContaining({ localEndpoint: 'http://localhost:1234' }));
        expect(mockRunAgentLoop).toHaveBeenCalledTimes(2);
        expect(mockRunAgentLoop.mock.calls[0][0]).toEqual(expect.objectContaining({ endpoint: 'http://localhost:1234' }));
        expect(mockRunAgentLoop.mock.calls[1][0]).toEqual(expect.objectContaining({ endpoint: 'http://localhost:1234' }));

        const firstHistory = mockRunAgentLoop.mock.calls[0][1] as ChatMessage[];
        const secondHistory = mockRunAgentLoop.mock.calls[1][1] as ChatMessage[];

        expect(secondHistory.length).toBeGreaterThan(firstHistory.length);
    });

    it('reutilise la meme identite pour le follow-up apres execution de tool', async () => {
        mockRunAgentLoop.mockResolvedValueOnce({
            finalResponse: 'follow-up analysis',
            toolCallLog: [
                {
                    id: 'tool-1',
                    functionName: 'lookupWeather',
                    arguments: {},
                    result: { city: 'Paris', temperature: 21 },
                    status: 'success',
                    durationMs: 8,
                    timestamp: new Date('2026-01-01T00:00:00.000Z'),
                    executionId: 'exec-1',
                },
            ],
            iterations: 1,
            finishReason: 'stop',
        });

        const agent = createAgent({
            id: 'agent-follow-up',
            localLLMProfileId: 'profile-alpha',
            tools: [{ name: 'lookupWeather', description: 'weather', parameters: {} }],
            capabilities: [LLMCapability.Chat],
        });

        const { result } = renderHook(() => useAgentChat({
            nodeId: 'node-follow-up',
            agent,
            llmConfigs: [LOCAL_RUNTIME_CONFIG],
            t: (key: string) => key,
            instanceId: 'instance-follow-up',
        }));

        await act(async () => {
            await result.current.handleSendMessage('need tool', null);
        });

        expect(mockCreateAdapter).toHaveBeenCalledTimes(1);
        expect(mockCreateAdapter.mock.calls[0][1]).toEqual(expect.objectContaining({ localEndpoint: 'http://localhost:11434' }));
        expect(mockRunAgentLoop).toHaveBeenCalledTimes(1);
        expect(mockRunAgentLoop.mock.calls[0][0]).toEqual(expect.objectContaining({ endpoint: 'http://localhost:11434' }));
        expect(useRuntimeStore.getState().getNodeMessages('node-follow-up')).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    sender: 'tool',
                    toolName: 'lookupWeather',
                }),
            ])
        );
    });

    it('le panel image utilise le credential resolu du profil local actif', async () => {
        mockedGenerateImage.mockResolvedValue({ image: 'generated-image' });

        render(
            <ImageGenerationPanel
                isOpen={true}
                hideSlideOver={true}
                nodeId="node-image"
                agent={createAgent({
                    id: 'agent-image',
                    localLLMProfileId: 'profile-alpha',
                    capabilities: [LLMCapability.ImageGeneration],
                })}
                workflowNodes={[]}
                llmConfigs={[LOCAL_RUNTIME_CONFIG]}
                onClose={jest.fn()}
                onImageGenerated={jest.fn()}
                onOpenImageModificationPanel={jest.fn()}
            />
        );

        await userEvent.type(screen.getByPlaceholderText('imageGen_promptPlaceholder'), 'draw a skyline');
        await userEvent.click(screen.getByRole('button', { name: 'imageGen_generate' }));

        await waitFor(() => {
            expect(mockedGenerateImage).toHaveBeenCalledWith(
                LLMProvider.LMStudio,
                'http://localhost:11434',
                'draw a skyline',
                'local-model'
            );
        });
    });

    it('le panel de modification d image reutilise le meme profil local pour edition et description', async () => {
        mockedEditImage.mockResolvedValue({ image: 'modified-image' });
        mockedGenerateContent.mockResolvedValue({ text: 'Image modifiee avec succes' });

        render(
            <ImageModificationPanel
                isOpen={true}
                editingImageInfo={{
                    nodeId: 'node-edit',
                    sourceImage: 'source-image',
                    mimeType: 'image/png',
                    agent: createAgent({
                        id: 'agent-edit',
                        localLLMProfileId: 'profile-beta',
                        capabilities: [LLMCapability.ImageModification],
                    }),
                }}
                workflowNodes={[]}
                llmConfigs={[LOCAL_RUNTIME_CONFIG]}
                onClose={jest.fn()}
                onImageModified={jest.fn()}
            />
        );

        await userEvent.type(screen.getByPlaceholderText('imageMod_promptPlaceholder'), 'remove the background');
        await userEvent.click(screen.getByRole('button', { name: 'imageMod_modify' }));

        await waitFor(() => {
            expect(mockedEditImage).toHaveBeenCalledWith(
                LLMProvider.LMStudio,
                'http://localhost:1234',
                'remove the background',
                { mimeType: 'image/png', data: 'source-image' }
            );
        });
    });

    it('le panel maps conserve le credential cloud courant sans derive locale', async () => {
        mockedGenerateContentWithMaps.mockResolvedValue({ text: 'maps result', mapSources: [] });

        const cloudAgent = createAgent({
            id: 'agent-maps',
            llmProvider: LLMProvider.Gemini,
            model: 'gemini-2.5-pro',
            capabilities: [LLMCapability.MapsGrounding],
        });

        const workflowNodes: WorkflowNode[] = [
            {
                id: 'node-maps',
                type: 'agentNode',
                position: { x: 0, y: 0 },
                data: { label: cloudAgent.name, robotId: RobotId.Archi, agent: cloudAgent },
                agent: cloudAgent,
            } as any,
        ];

        render(
            <MapsGroundingConfigPanel
                isOpen={true}
                hideSlideOver={true}
                nodeId="node-maps"
                workflowNodes={workflowNodes}
                llmConfigs={[CLOUD_RUNTIME_CONFIG]}
                onClose={jest.fn()}
            />
        );

        await userEvent.type(
            screen.getByPlaceholderText('Ex: Restaurants japonais à Paris, Hôtels 5 étoiles à New York...'),
            'restaurants in Paris'
        );
        await userEvent.click(screen.getByRole('button', { name: '🔍 Rechercher' }));

        await waitFor(() => {
            expect(mockedGenerateContentWithMaps).toHaveBeenCalledWith(
                LLMProvider.Gemini,
                'gemini-test-key-placeholder',
                'gemini-2.5-pro',
                'restaurants in Paris',
                undefined,
                undefined
            );
        });
    });
});
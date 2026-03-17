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

jest.mock('../../hooks/useLocalization', () => ({
    useLocalization: () => ({
        t: (key: string) => key,
    }),
}));

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
    apiKey: 'gemini-live-key',
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
    });

    it('isole deux agents locaux du meme provider avec des endpoints differents', async () => {
        mockedGenerateContentStream
            .mockImplementationOnce(() => createStream([{ response: { text: 'agent alpha' } }]))
            .mockImplementationOnce(() => createStream([{ response: { text: 'agent beta' } }])) ;

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
        }));

        await act(async () => {
            await firstHook.result.current.handleSendMessage('hello alpha', null);
        });

        const secondHook = renderHook(() => useAgentChat({
            nodeId: 'node-beta',
            agent: secondAgent,
            llmConfigs: [LOCAL_RUNTIME_CONFIG],
            t: (key: string) => key,
        }));

        await act(async () => {
            await secondHook.result.current.handleSendMessage('hello beta', null);
        });

        expect(mockedGenerateContentStream).toHaveBeenCalledTimes(2);
        expect(mockedGenerateContentStream.mock.calls[0][1]).toBe('http://localhost:11434');
        expect(mockedGenerateContentStream.mock.calls[0][7]).toBe('http://localhost:11434');
        expect(mockedGenerateContentStream.mock.calls[1][1]).toBe('http://localhost:1234');
        expect(mockedGenerateContentStream.mock.calls[1][7]).toBe('http://localhost:1234');
    });

    it('conserve la meme identite runtime sur plusieurs tours consecutifs', async () => {
        mockedGenerateContentStream
            .mockImplementationOnce(() => createStream([{ response: { text: 'turn one answer' } }]))
            .mockImplementationOnce(() => createStream([{ response: { text: 'turn two answer' } }])) ;

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
        }));

        await act(async () => {
            await result.current.handleSendMessage('first turn', null);
        });

        await act(async () => {
            await result.current.handleSendMessage('second turn', null);
        });

        expect(mockedGenerateContentStream).toHaveBeenCalledTimes(2);
        expect(mockedGenerateContentStream.mock.calls[0][1]).toBe('http://localhost:1234');
        expect(mockedGenerateContentStream.mock.calls[1][1]).toBe('http://localhost:1234');

        const firstHistory = mockedGenerateContentStream.mock.calls[0][4] as ChatMessage[];
        const secondHistory = mockedGenerateContentStream.mock.calls[1][4] as ChatMessage[];

        expect(secondHistory.length).toBeGreaterThan(firstHistory.length);
    });

    it('reutilise la meme identite pour le follow-up apres execution de tool', async () => {
        mockedGenerateContentStream
            .mockImplementationOnce(() => createStream([
                { response: { text: 'tool preface', toolCalls: [{ id: 'tool-1', name: 'lookupWeather', arguments: '{}' }] } },
            ]))
            .mockImplementationOnce(() => createStream([
                { response: { text: 'follow-up analysis' } },
            ]));
        mockedExecuteTool.mockResolvedValue({ city: 'Paris', temperature: 21 });

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
        }));

        await act(async () => {
            await result.current.handleSendMessage('need tool', null);
        });

        expect(mockedGenerateContentStream).toHaveBeenCalledTimes(2);
        expect(mockedGenerateContentStream.mock.calls[0][1]).toBe('http://localhost:11434');
        expect(mockedGenerateContentStream.mock.calls[1][1]).toBe('http://localhost:11434');

        const followUpHistory = mockedGenerateContentStream.mock.calls[1][4] as ChatMessage[];
        expect(followUpHistory.some(message => message.text.includes('tool_results_context'))).toBe(true);
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
                'gemini-live-key',
                'gemini-2.5-pro',
                'restaurants in Paris',
                undefined,
                undefined
            );
        });
    });
});
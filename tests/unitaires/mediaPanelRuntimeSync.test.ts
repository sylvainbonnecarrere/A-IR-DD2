import { AgentInstance, LLMProvider } from '../../types';
import { remapAgentInstanceReference, remapEditingImageInfo, remapPanelNodeId } from '../../utils/mediaPanelRuntimeSync';

const createAgentInstance = (overrides: Partial<AgentInstance> = {}): AgentInstance => ({
    id: 'temp-instance',
    prototypeId: 'prototype-1',
    name: 'Image Agent',
    position: { x: 10, y: 20 },
    workflowId: 'workflow-temp',
    isMinimized: false,
    isMaximized: false,
    configuration_json: {
        role: 'assistant',
        model: 'gemini-2.0-flash',
        llmProvider: LLMProvider.Gemini,
        systemPrompt: 'Generate images',
        tools: [],
        position: { x: 10, y: 20 },
    },
    ...overrides,
});

describe('mediaPanelRuntimeSync', () => {
    it('remaps active media panel references when a temp instance becomes persistent', () => {
        const remappedImageNodeId = remapPanelNodeId('node-temp-instance', 'node-temp-instance', 'node-real-instance');
        const remappedVideoNodeId = remapPanelNodeId('node-temp-instance', 'node-temp-instance', 'node-real-instance');
        const remappedMapsNodeId = remapPanelNodeId('node-temp-instance', 'node-temp-instance', 'node-real-instance');

        const remappedImageAgentInstance = remapAgentInstanceReference(
            createAgentInstance(),
            'temp-instance',
            'real-instance',
            'workflow-1',
        );

        const remappedEditingImageInfo = remapEditingImageInfo(
            {
                nodeId: 'node-temp-instance',
                sourceImage: 'ZmFrZS1pbWFnZQ==',
                mimeType: 'image/png',
                agentInstance: createAgentInstance(),
            },
            'node-temp-instance',
            'node-real-instance',
            'temp-instance',
            'real-instance',
            'workflow-1',
        );

        expect(remappedImageNodeId).toBe('node-real-instance');
        expect(remappedVideoNodeId).toBe('node-real-instance');
        expect(remappedMapsNodeId).toBe('node-real-instance');
        expect(remappedImageAgentInstance).toEqual(expect.objectContaining({
            id: 'real-instance',
            workflowId: 'workflow-1',
        }));
        expect(remappedEditingImageInfo).toEqual(expect.objectContaining({
            nodeId: 'node-real-instance',
            agentInstance: expect.objectContaining({
                id: 'real-instance',
                workflowId: 'workflow-1',
            }),
        }));
    });

    it('leaves unrelated panel references unchanged', () => {
        const untouchedPanelNodeId = remapPanelNodeId('node-other-instance', 'node-temp-instance', 'node-real-instance');
        const untouchedAgentInstance = remapAgentInstanceReference(
            createAgentInstance({
                id: 'other-instance',
                prototypeId: 'prototype-2',
                name: 'Other Agent',
                position: { x: 30, y: 40 },
                workflowId: 'workflow-2',
                configuration_json: {
                    role: 'assistant',
                    model: 'gemini-2.0-flash',
                    llmProvider: LLMProvider.Gemini,
                    systemPrompt: 'Other agent',
                    tools: [],
                    position: { x: 30, y: 40 },
                },
            }),
            'temp-instance',
            'real-instance',
            'workflow-1',
        );
        const untouchedEditingImageInfo = remapEditingImageInfo(
            {
                nodeId: 'node-other-instance',
                sourceImage: 'b3RoZXI=',
                mimeType: 'image/png',
            },
            'node-temp-instance',
            'node-real-instance',
            'temp-instance',
            'real-instance',
            'workflow-1',
        );

        expect(untouchedPanelNodeId).toBe('node-other-instance');
        expect(untouchedAgentInstance).toEqual(expect.objectContaining({
            id: 'other-instance',
            workflowId: 'workflow-2',
        }));
        expect(untouchedEditingImageInfo).toEqual(expect.objectContaining({
            nodeId: 'node-other-instance',
        }));
    });
});
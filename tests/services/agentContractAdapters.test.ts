import { LLMProvider, RobotId } from '../../types';
import {
    mapPersistedInstanceToAgentInstance,
    mapPersistedInstanceToV2Node,
    mapPersistedPrototypeToAgent,
} from '../../services/agentContractAdapters';

describe('agentContractAdapters legacy contract guards', () => {
    const fallbackTimestamp = '2026-05-19T10:00:00.000Z';

    it('maps legacy prototype aliases to canonical agent fields', () => {
        const agent = mapPersistedPrototypeToAgent({
            _id: 'prototype-1',
            name: 'Legacy Prototype',
            description: 'Legacy assistant',
            provider: LLMProvider.Gemini,
            llmModel: 'gemini-2.0-flash',
            tools: ['tool.weather'],
            robotId: RobotId.Archi,
            createdAt: '2026-05-18T10:00:00.000Z',
            updatedAt: '2026-05-18T11:00:00.000Z',
        }, fallbackTimestamp);

        expect(agent).toEqual(expect.objectContaining({
            id: 'prototype-1',
            name: 'Legacy Prototype',
            role: 'Legacy assistant',
            systemPrompt: 'Legacy assistant',
            llmProvider: LLMProvider.Gemini,
            model: 'gemini-2.0-flash',
            creator_id: RobotId.Archi,
            created_at: '2026-05-18T10:00:00.000Z',
            updated_at: '2026-05-18T11:00:00.000Z',
        }));
        expect(agent.functionIds).toEqual(['tool.weather']);
    });

    it('sanitizes provider tools and falls back to the provided timestamps when prototype metadata is missing', () => {
        const agent = mapPersistedPrototypeToAgent({
            _id: 'prototype-tools',
            name: 'Prototype tools',
            toolSelections: [{ toolId: 'tool.search' }],
            tools: [
                { name: ' web_search_py ', description: 'Search the web', parameters: { type: 'object' }, outputSchema: { type: 'object' } },
                { name: '   ', description: 'Ignored', parameters: { type: 'object' } },
                'legacy-ignored',
            ],
        }, fallbackTimestamp);

        expect(agent.toolSelections).toEqual([{ toolId: 'tool.search' }]);
        expect(agent.functionIds).toEqual(['tool.search']);
        expect(agent.tools).toEqual([
            {
                name: 'web_search_py',
                description: 'Search the web',
                parameters: { type: 'object' },
                outputSchema: { type: 'object' },
            },
        ]);
        expect(agent.created_at).toBe(fallbackTimestamp);
        expect(agent.updated_at).toBe(fallbackTimestamp);
    });

    it('hydrates persisted instances with canonical configuration fallbacks', () => {
        const prototype = mapPersistedPrototypeToAgent({
            id: 'prototype-1',
            name: 'Prototype canonique',
            role: 'assistant',
            systemPrompt: 'Prototype prompt',
            llmProvider: LLMProvider.Gemini,
            model: 'gemini-2.0-flash',
            toolSelections: [{ toolId: 'tool.weather' }],
            creator_id: RobotId.Archi,
        }, fallbackTimestamp);

        const instance = mapPersistedInstanceToAgentInstance({
            _id: 'instance-1',
            prototypeId: 'prototype-1',
            name: 'Instance legacy',
            workflowId: 'workflow-1',
            position: { x: 12, y: 24 },
            llmModel: 'gemini-2.0-flash',
            provider: LLMProvider.Gemini,
            systemInstruction: 'Legacy prompt',
            persistenceConfig: {
                saveMedia: true,
                mediaStorage: 'cloud',
                cloudConnectionProfileId: 'cloud-profile-1',
            },
            configuration_json: {
                role: 'operator',
                links: ['link-1'],
            },
        }, 'workflow-1', prototype);

        expect(instance).toEqual(expect.objectContaining({
            id: 'instance-1',
            prototypeId: 'prototype-1',
            name: 'Instance legacy',
            workflowId: 'workflow-1',
            position: { x: 12, y: 24 },
            persistenceConfig: expect.objectContaining({
                mediaStorage: 'cloud',
                cloudConnectionProfileId: 'cloud-profile-1',
            }),
            configuration_json: expect.objectContaining({
                role: 'operator',
                model: 'gemini-2.0-flash',
                llmProvider: LLMProvider.Gemini,
                systemPrompt: 'Legacy prompt',
                toolSelections: [{ toolId: 'tool.weather' }],
                position: { x: 12, y: 24 },
                links: ['link-1'],
            }),
        }));
    });

    it('hydrates instance configuration from prototype defaults and nested position when legacy fields are absent', () => {
        const prototype = mapPersistedPrototypeToAgent({
            id: 'prototype-fallback',
            name: 'Prototype fallback',
            role: 'coordinator',
            systemPrompt: 'Prototype instructions',
            llmProvider: LLMProvider.Gemini,
            model: 'gemini-2.0-flash',
            toolSelections: [{ toolId: 'tool.catalog' }],
            localLLMProfileId: 'local-profile-1',
            creator_id: RobotId.Bos,
        }, fallbackTimestamp);

        const instance = mapPersistedInstanceToAgentInstance({
            _id: 'instance-fallback',
            prototypeId: 'prototype-fallback',
            configuration_json: {
                position: { x: 91, y: 182 },
            },
        }, undefined, prototype);

        expect(instance).toEqual(expect.objectContaining({
            id: 'instance-fallback',
            prototypeId: 'prototype-fallback',
            name: 'Prototype fallback',
            position: { x: 91, y: 182 },
            configuration_json: expect.objectContaining({
                role: 'coordinator',
                model: 'gemini-2.0-flash',
                llmProvider: LLMProvider.Gemini,
                systemPrompt: 'Prototype instructions',
                toolSelections: [{ toolId: 'tool.catalog' }],
                localLLMProfileId: 'local-profile-1',
                position: { x: 91, y: 182 },
            }),
        }));
    });

    it('projects legacy instance records to V2 nodes with canonical robot identity', () => {
        const node = mapPersistedInstanceToV2Node({
            _id: 'instance-2',
            name: 'Node legacy',
            robotId: RobotId.Archi,
            role: 'assistant',
            systemPrompt: 'Prompt',
            llmProvider: LLMProvider.Gemini,
            llmModel: 'gemini-2.0-flash',
            capabilities: [],
            position: { x: 3, y: 4 },
        }, 'workflow-1', undefined, fallbackTimestamp);

        expect(node).toEqual(expect.objectContaining({
            id: 'node-instance-2',
            type: 'agent',
            position: { x: 3, y: 4 },
            data: expect.objectContaining({
                robotId: RobotId.Archi,
                label: 'Node legacy',
                workflowId: 'workflow-1',
                agent: expect.objectContaining({
                    id: 'instance-2',
                    creator_id: RobotId.Archi,
                }),
                agentInstance: expect.objectContaining({
                    id: 'instance-2',
                    workflowId: 'workflow-1',
                }),
            }),
        }));
    });

    it('keeps the persisted workflow identity in projected V2 node data when the explicit workflowId is omitted', () => {
        const node = mapPersistedInstanceToV2Node({
            _id: 'instance-3',
            workflowId: 'workflow-from-record',
            name: 'Node with persisted workflow',
            role: 'assistant',
            systemPrompt: 'Prompt',
            llmProvider: LLMProvider.Gemini,
            model: 'gemini-2.0-flash',
            position: { x: 8, y: 9 },
        }, undefined, undefined, fallbackTimestamp);

        expect(node.data.workflowId).toBe('workflow-from-record');
        expect(node.data.agentInstance).toEqual(expect.objectContaining({
            id: 'instance-3',
            workflowId: 'workflow-from-record',
        }));
    });
});
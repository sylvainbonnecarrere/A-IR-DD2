import { LLMProvider, RobotId, type Agent } from '../../types';
import { createAgentPrototype, mapAPIResponseToAgent, updateAgentPrototype } from '../../services/agentPrototypeAPI';

describe('agentPrototypeAPI tool reference convergence', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ success: true }),
        }) as unknown as typeof fetch;
    });

    afterEach(() => {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    const baseAgent: Omit<Agent, 'id' | 'creator_id' | 'created_at' | 'updated_at'> = {
        name: 'Prototype Meteo',
        role: 'assistant',
        systemPrompt: 'Be useful',
        llmProvider: LLMProvider.Gemini,
        model: 'gemini-2.0-flash',
        capabilities: [],
        tools: [],
        functionIds: ['legacy-stale'],
        toolSelections: [{
            toolId: 'tool.weather',
            versionRef: {
                versionTag: 'v3',
                versionNumber: 3,
                workspaceId: 'ws-1',
            },
        }],
    };

    it('maps API responses with empty legacy aliases back to canonical tool selections and derived functionIds', () => {
        expect(mapAPIResponseToAgent({
            _id: 'agent-1',
            name: 'Prototype Meteo',
            role: 'assistant',
            systemPrompt: 'Be useful',
            llmProvider: LLMProvider.Gemini,
            llmModel: 'gemini-2.0-flash',
            capabilities: [],
            functionIds: [],
            toolSelections: [{ toolId: 'tool.weather' }],
            robotId: RobotId.Archi,
        })).toEqual(expect.objectContaining({
            functionIds: ['tool.weather'],
            toolSelections: [{ toolId: 'tool.weather' }],
        }));
    });

    it('derives legacy functionIds from canonical toolSelections when creating a prototype', async () => {
        await createAgentPrototype(baseAgent, 'token-123', RobotId.Archi);

        const fetchMock = global.fetch as jest.Mock;
        const [, options] = fetchMock.mock.calls[0];
        const payload = JSON.parse(options.body as string);

        expect(payload).toEqual(expect.objectContaining({
            functionIds: ['tool.weather'],
            toolSelections: [expect.objectContaining({ toolId: 'tool.weather' })],
        }));
    });

    it('keeps toolSelections canonical when updating a prototype and clearing legacy drift', async () => {
        await updateAgentPrototype('agent-1', {
            functionIds: ['legacy-stale'],
            toolSelections: [{ toolId: 'tool.weather' }],
        }, 'token-123', RobotId.Archi);

        const fetchMock = global.fetch as jest.Mock;
        const [, options] = fetchMock.mock.calls[0];
        const payload = JSON.parse(options.body as string);

        expect(payload).toEqual(expect.objectContaining({
            functionIds: ['tool.weather'],
            toolSelections: [{ toolId: 'tool.weather' }],
        }));
    });
});
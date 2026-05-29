import { LLMProvider, RobotId, type Agent } from '../../types';
import { createAgentPrototype, fetchAgentPrototypeImpact, fetchAgentPrototypes, mapAPIResponseToAgent, mergeAgentPrototypeImpacts, updateAgentPrototype } from '../../services/agentPrototypeAPI';

describe('agentPrototypeAPI tool reference convergence', () => {
    const originalFetch = global.fetch;
    const prototypeApiRecord = {
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
    };

    beforeEach(() => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => prototypeApiRecord,
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
        persistenceConfig: {
            saveChat: true,
            saveErrors: true,
            saveHistorySummary: false,
            saveLinks: false,
            saveTasks: false,
            saveMedia: true,
            mediaStorage: 'cloud',
            allowWorkspaceWrite: true,
            cloudConnectionProfileId: 'cloud-profile-1',
        },
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
        const result = await createAgentPrototype(baseAgent, 'token-123', RobotId.Archi);

        const fetchMock = global.fetch as jest.Mock;
        const [, options] = fetchMock.mock.calls[0];
        const payload = JSON.parse(options.body as string);

        expect(payload).toEqual(expect.objectContaining({
            functionIds: ['tool.weather'],
            toolSelections: [expect.objectContaining({ toolId: 'tool.weather' })],
            persistenceConfig: expect.objectContaining({
                mediaStorage: 'cloud',
                cloudConnectionProfileId: 'cloud-profile-1',
            }),
        }));
        expect(result.data).toEqual(expect.objectContaining({
            id: 'agent-1',
            creator_id: RobotId.Archi,
        }));
    });

    it('keeps toolSelections canonical when updating a prototype and clearing legacy drift', async () => {
        const result = await updateAgentPrototype('agent-1', {
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
        expect(result.data).toEqual(expect.objectContaining({
            id: 'agent-1',
            creator_id: RobotId.Archi,
        }));
    });

    it('maps persistenceConfig cloud profile references from API responses', () => {
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
            persistenceConfig: {
                saveChat: true,
                saveErrors: true,
                saveHistorySummary: false,
                saveLinks: false,
                saveTasks: false,
                saveMedia: true,
                mediaStorage: 'cloud',
                allowWorkspaceWrite: true,
                cloudConnectionProfileId: 'cloud-profile-1',
            },
            robotId: RobotId.Archi,
        })).toEqual(expect.objectContaining({
            persistenceConfig: expect.objectContaining({
                mediaStorage: 'cloud',
                cloudConnectionProfileId: 'cloud-profile-1',
            }),
        }));
    });

    it('fetches live prototype impact scoped to a workflow', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                instanceCount: 1,
                nodeCount: 1,
                instances: [{ id: 'instance-1', name: 'Live instance', position: { x: 10, y: 20 } }],
                nodeIds: ['node-1'],
            }),
        }) as unknown as typeof fetch;

        const result = await fetchAgentPrototypeImpact('agent-1', 'token-123', 'workflow-1');

        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('/api/agent-prototypes/agent-1/impact?workflowId=workflow-1'),
            expect.objectContaining({ method: 'GET' }),
        );
        expect(result.success).toBe(true);
        expect(result.data).toEqual(expect.objectContaining({
            instanceCount: 1,
            nodeCount: 1,
            instances: [expect.objectContaining({ id: 'instance-1' })],
            nodeIds: ['node-1'],
        }));
    });

    it('merges backend and local prototype impact without dropping unsaved active instances', () => {
        expect(mergeAgentPrototypeImpacts(
            {
                instanceCount: 1,
                nodeCount: 1,
                instances: [{ id: 'instance-saved', name: 'Saved', position: { x: 10, y: 20 } }],
                nodeIds: ['node-saved'],
            },
            {
                instanceCount: 1,
                nodeCount: 1,
                instances: [{ id: 'instance-unsaved', name: 'Unsaved', position: { x: 30, y: 40 } }],
                nodeIds: ['node-unsaved'],
            },
        )).toEqual({
            instanceCount: 2,
            nodeCount: 2,
            instances: [
                { id: 'instance-saved', name: 'Saved', position: { x: 10, y: 20 } },
                { id: 'instance-unsaved', name: 'Unsaved', position: { x: 30, y: 40 } },
            ],
            nodeIds: ['node-saved', 'node-unsaved'],
        });
    });

    it('maps fetched prototype lists to canonical agents', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ([prototypeApiRecord]),
        }) as unknown as typeof fetch;

        const result = await fetchAgentPrototypes('token-123', 'workflow-1');

        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('/api/agent-prototypes?workflowId=workflow-1'),
            expect.objectContaining({ method: 'GET' }),
        );
        expect(result.data).toEqual([
            expect.objectContaining({
                id: 'agent-1',
                creator_id: RobotId.Archi,
                model: 'gemini-2.0-flash',
            }),
        ]);
    });
});
import request from 'supertest';
import express from 'express';
import passport from 'passport';
import '../middleware/auth.middleware';
import { User } from '../models/User.model';
import { Workflow } from '../models/Workflow.model';
import { AgentPrototype } from '../models/AgentPrototype.model';
import { AgentInstance } from '../models/AgentInstance.model';
import agentPrototypesRoutes from '../routes/agent-prototypes.routes';
import agentInstancesRoutes from '../routes/agent-instances.routes';
import { generateAccessToken } from '../utils/jwt';

const TEST_ONLY_PASSWORD = 'test-only-password-123';

const app = express();
app.use(express.json());
app.use(passport.initialize());
app.use('/api/workflows/:workflowId/instances', agentInstancesRoutes);
app.use('/api/agent-prototypes', agentPrototypesRoutes);
app.use('/api/agent-instances', agentInstancesRoutes);

describe('webSearchParams canonical backend validation', () => {
    let user: any;
    let accessToken: string;
    let workflow: any;
    let prototype: any;
    let instance: any;

    beforeEach(async () => {
        user = await User.create({
            email: `web-search-params-${Date.now()}@test.com`,
            password: TEST_ONLY_PASSWORD,
            username: `wsp${Date.now()}`,
        });

        accessToken = generateAccessToken({
            sub: user.id,
            email: user.email,
            role: user.role,
        });

        workflow = await Workflow.create({
            userId: user.id,
            name: 'Web Search Params workflow',
        });

        prototype = await AgentPrototype.create({
            userId: user.id,
            workflowId: workflow.id,
            name: 'Archi prototype',
            role: 'Assistant',
            systemPrompt: 'Prompt',
            llmProvider: 'Gemini',
            llmModel: 'gemini-2.0',
            robotId: 'AR_001',
        });

        instance = await AgentInstance.create({
            workflowId: workflow.id,
            userId: user.id,
            prototypeId: prototype.id,
            executionId: `run-${Date.now()}`,
            status: 'running',
            name: 'Instance Archi',
            role: 'Assistant',
            systemPrompt: 'Prompt',
            llmProvider: 'Gemini',
            llmModel: 'gemini-2.0',
            capabilities: [],
            robotId: 'AR_001',
            position: { x: 10, y: 20 },
            isMinimized: false,
            isMaximized: false,
            zIndex: 0,
            content: [],
            metrics: {
                totalTokens: 0,
                totalErrors: 0,
                totalMediaGenerated: 0,
                callCount: 0,
            },
            persistenceConfig: {
                saveChat: true,
                saveErrors: true,
                saveHistorySummary: false,
                saveLinks: false,
                saveTasks: false,
                mediaStorage: 'db',
            },
        });
    });

    afterEach(async () => {
        await User.deleteMany({ _id: user._id });
    });

    it('normalizes and persists canonical webSearchParams on prototype creation', async () => {
        const response = await request(app)
            .post('/api/agent-prototypes')
            .set('Authorization', `Bearer ${accessToken}`)
            .set('X-Robot-Id', 'AR_001')
            .send({
                name: 'Prototype with web search params',
                role: 'Assistant',
                systemPrompt: 'Valid creator',
                llmProvider: 'Gemini',
                llmModel: 'gemini-2.0',
                robotId: 'AR_001',
                capabilities: [],
                webSearchParams: {
                    nb_request_transformation: 1,
                    request_list: true,
                    max_uses: 3,
                    cross_lingual_search: false,
                    web_engine_search: true,
                    web_engine: 'duckduckgo.com',
                    web_engine_nb_result_select: 2,
                    dig_snippet: false,
                    allowed_domains: [' example.com ', 'example.com', 'docs.openai.com'],
                    query_transformation: 'prompt transformation',
                    reranking_prompt: 'prompt reranking',
                    relevance_threshold: 8,
                    rerank_strategy: 'Fast',
                },
            });

        expect(response.status).toBe(201);
        expect(response.body.webSearchParams).toEqual(expect.objectContaining({
            nb_request_transformation: 1,
            request_list: false,
            allowed_domains: ['example.com', 'docs.openai.com'],
            relevance_threshold: 8,
            rerank_strategy: 'Fast',
        }));
    });

    it('rejects logically invalid webSearchParams on prototype creation', async () => {
        const response = await request(app)
            .post('/api/agent-prototypes')
            .set('Authorization', `Bearer ${accessToken}`)
            .set('X-Robot-Id', 'AR_001')
            .send({
                name: 'Prototype invalid web search params',
                role: 'Assistant',
                systemPrompt: 'Invalid creator',
                llmProvider: 'Gemini',
                llmModel: 'gemini-2.0',
                robotId: 'AR_001',
                capabilities: [],
                webSearchParams: {
                    nb_request_transformation: 1,
                    request_list: false,
                    max_uses: 5,
                    cross_lingual_search: false,
                    web_engine_search: false,
                    web_engine: 'duckduckgo.com',
                    web_engine_nb_result_select: 3,
                    dig_snippet: true,
                    allowed_domains: [],
                    query_transformation: 'prompt transformation',
                    reranking_prompt: 'prompt reranking',
                    relevance_threshold: 7,
                    rerank_strategy: 'Fast',
                },
            });

        expect(response.status).toBe(400);
        expect(response.body.details).toEqual(expect.arrayContaining([
            expect.objectContaining({
                field: 'webSearchParams.dig_snippet',
                message: 'dig_snippet nécessite web_engine_search=true.',
            }),
        ]));
    });

    it('normalizes obsolete nested configuration_json.webSearchParams on instance update', async () => {
        const response = await request(app)
            .put(`/api/agent-instances/${instance.id}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .set('X-Robot-Id', 'AR_001')
            .send({
                configuration_json: {
                    webSearchParams: {
                        nb_request_transformation: 0,
                    },
                },
            });

        expect(response.status).toBe(200);
        expect(response.body.webSearchParams).toEqual(expect.objectContaining({
            nb_request_transformation: 1,
            request_list: false,
        }));
    });

    it('normalizes nested configuration_json.webSearchParams when creating an instance from prototype', async () => {
        const response = await request(app)
            .post(`/api/workflows/${workflow.id}/instances/from-prototype`)
            .set('Authorization', `Bearer ${accessToken}`)
            .set('X-Robot-Id', 'AR_001')
            .send({
                prototypeId: prototype.id,
                position: { x: 30, y: 40 },
                configuration_json: {
                    webSearchParams: {
                        nb_request_transformation: 1,
                        request_list: true,
                        max_uses: 4,
                        cross_lingual_search: false,
                        web_engine_search: true,
                        web_engine: 'google.com',
                        web_engine_nb_result_select: 3,
                        dig_snippet: false,
                        allowed_domains: [' example.com ', 'example.com'],
                        query_transformation: 'prompt transformation',
                        reranking_prompt: 'prompt reranking',
                        relevance_threshold: 7,
                        rerank_strategy: 'Deep',
                    },
                },
            });

        expect(response.status).toBe(201);
        expect(response.body.configuration_json.webSearchParams).toEqual(expect.objectContaining({
            nb_request_transformation: 1,
            request_list: false,
            allowed_domains: ['example.com'],
            web_engine: 'google.com',
            rerank_strategy: 'Deep',
        }));
    });

    it('ignores obsolete multi-query webSearchParams fields on instance update', async () => {
        const response = await request(app)
            .put(`/api/agent-instances/${instance.id}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .set('X-Robot-Id', 'AR_001')
            .send({
                configuration_json: {
                    webSearchParams: {
                        nb_request_transformation: 0,
                        request_list: true,
                    },
                },
            });

        expect(response.status).toBe(200);
        expect(response.body.webSearchParams).toEqual(expect.objectContaining({
            nb_request_transformation: 1,
            request_list: false,
        }));
    });
});
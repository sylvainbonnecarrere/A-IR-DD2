// Test simple et isolé pour /from-prototype
import request from 'supertest';
import express from 'express';
import '../middleware/auth.middleware';
import passport from 'passport';
import { User } from '../models/User.model';
import { Workflow } from '../models/Workflow.model';
import { AgentPrototype } from '../models/AgentPrototype.model';
import { WorkflowNodeV2 } from '../models/WorkflowNodeV2.model';
import agentInstancesRoutes from '../routes/agent-instances.routes';
import { generateAccessToken } from '../utils/jwt';

const TEST_ONLY_PASSWORD = 'test-only-password-123';

const app = express();
app.use(express.json());
app.use(passport.initialize());
app.use('/api/workflows/:workflowId/instances', agentInstancesRoutes);
app.use('/api/agent-instances', agentInstancesRoutes);

describe('Simple Test - POST /from-prototype', () => {
    let user: any;
    let token: string;
    let workflow: any;
    let prototype: any;
    let workflowId: string;
    let prototypeId: string;

    beforeAll(async () => {
        // Create user
        user = await User.create({
            email: `test-simple-${Date.now()}@test.com`,
            password: TEST_ONLY_PASSWORD,
            username: `user${Date.now()}`
        });

        token = generateAccessToken({ sub: user.id, email: user.email, role: user.role });

    }, 30000);

    beforeEach(async () => {
        workflow = await Workflow.create({
            userId: user.id,
            name: 'Test Workflow'
        });
        workflowId = workflow.id;

        prototype = await AgentPrototype.create({
            userId: user.id,
            name: 'Test Proto',
            role: 'Test',
            systemPrompt: 'Test prompt',
            llmProvider: 'Gemini',
            llmModel: 'gemini-2.0',
            robotId: 'AR_001'
        });
        prototypeId = prototype.id;
    });

    afterAll(async () => {
        await User.deleteOne({ _id: user._id });
    });

    it('POST /from-prototype should create instance', async () => {
        const res = await request(app)
            .post(`/api/workflows/${workflowId}/instances/from-prototype`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                prototypeId,
                position: { x: 10, y: 20 }
            });

        console.log('Response status:', res.status);
        console.log('Response body:', JSON.stringify(res.body));

        expect(res.status).toBe(201);
        expect(res.body.id).toBeDefined();
        expect(res.body.name).toBe('Test Proto');
        expect(res.body.node).toEqual(expect.objectContaining({
            instanceId: res.body.id,
            nodeType: 'agent',
            position: expect.objectContaining({ x: 10, y: 20 }),
        }));

        const persistedNode = await WorkflowNodeV2.findOne({
            workflowId,
            ownerId: user.id,
            instanceId: res.body.id,
            nodeType: 'agent',
        }).lean();

        expect(persistedNode).toEqual(expect.objectContaining({
            position: expect.objectContaining({ x: 10, y: 20 }),
            uiConfig: expect.objectContaining({ label: 'Test Proto', expanded: true }),
        }));
    });

    it('POST /from-prototype should preserve a workspace media override on the created instance', async () => {
        await AgentPrototype.findByIdAndUpdate(prototypeId, {
            $set: {
                persistenceConfig: {
                    saveChat: true,
                    saveErrors: true,
                    saveHistorySummary: false,
                    saveLinks: false,
                    saveTasks: false,
                    saveMedia: true,
                    allowWorkspaceWrite: false,
                    mediaStorage: 'db',
                }
            }
        });

        const res = await request(app)
            .post(`/api/workflows/${workflowId}/instances/from-prototype`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                prototypeId,
                position: { x: 30, y: 40 },
                persistenceConfig: {
                    saveMedia: true,
                    mediaStorage: 'workspace',
                    allowWorkspaceWrite: true,
                },
            });

        expect(res.status).toBe(201);
        expect(res.body.persistenceConfig).toEqual(expect.objectContaining({
            saveMedia: true,
            mediaStorage: 'workspace',
            allowWorkspaceWrite: true,
        }));
    });

    it('updates workspace media persistence and synchronizes the canonical workflow node position on instance save', async () => {
        const creationResponse = await request(app)
            .post(`/api/workflows/${workflowId}/instances/from-prototype`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                prototypeId,
                position: { x: 50, y: 60 }
            })
            .expect(201);

        const updateResponse = await request(app)
            .put(`/api/agent-instances/${creationResponse.body.id}`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                name: 'Test Proto',
                position: { x: 140, y: 260 },
                configuration_json: {
                    role: 'Test',
                    systemPrompt: 'Test prompt',
                    llmProvider: 'Gemini',
                    model: 'gemini-2.0',
                    capabilities: ['Chat'],
                    position: { x: 50, y: 60 }
                },
                persistenceConfig: {
                    saveChat: true,
                    saveErrors: true,
                    saveHistorySummary: false,
                    saveLinks: false,
                    saveTasks: false,
                    saveMedia: true,
                    allowWorkspaceWrite: true,
                    mediaStorage: 'workspace'
                }
            });

        expect(updateResponse.status).toBe(200);
        expect(updateResponse.body.persistenceConfig).toEqual(expect.objectContaining({
            saveMedia: true,
            mediaStorage: 'workspace',
            allowWorkspaceWrite: true,
        }));
        expect(updateResponse.body.position).toEqual(expect.objectContaining({ x: 140, y: 260 }));

        const persistedNode = await WorkflowNodeV2.findOne({
            workflowId,
            ownerId: user.id,
            instanceId: creationResponse.body.id,
            nodeType: 'agent',
        }).lean();

        expect(persistedNode).toEqual(expect.objectContaining({
            position: expect.objectContaining({ x: 140, y: 260 }),
        }));
    });
});

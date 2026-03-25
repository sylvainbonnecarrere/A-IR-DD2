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

describe('Robot governance backend-first', () => {
    let user: any;
    let accessToken: string;
    let workflow: any;
    let prototype: any;
    let instance: any;

    beforeEach(async () => {
        user = await User.create({
            email: `robot-governance-${Date.now()}@test.com`,
            password: TEST_ONLY_PASSWORD,
            username: `rg${Date.now()}`
        });

        accessToken = generateAccessToken({
            sub: user.id,
            email: user.email,
            role: user.role
        });

        workflow = await Workflow.create({
            userId: user.id,
            name: 'Governance workflow'
        });

        prototype = await AgentPrototype.create({
            userId: user.id,
            workflowId: workflow.id,
            name: 'Archi prototype',
            role: 'Assistant',
            systemPrompt: 'Prompt',
            llmProvider: 'Gemini',
            llmModel: 'gemini-2.0',
            robotId: 'AR_001'
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
                callCount: 0
            },
            persistenceConfig: {
                saveChat: true,
                saveErrors: true,
                saveHistorySummary: false,
                saveLinks: false,
                saveTasks: false,
                mediaStorage: 'db'
            }
        });
    });

    afterEach(async () => {
        await User.deleteMany({ _id: user._id });
    });

    it('refuses prototype creation with unauthorized robotId', async () => {
        const response = await request(app)
            .post('/api/agent-prototypes')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
                name: 'Bos should not create agent',
                role: 'Supervisor',
                systemPrompt: 'Invalid agent creator',
                llmProvider: 'Gemini',
                llmModel: 'gemini-2.0',
                robotId: 'BO_002',
                capabilities: [],
                tools: []
            });

        expect(response.status).toBe(403);
        expect(response.body.code).toBe('ROBOT_POLICY_DENIED');
    });

    it('allows prototype creation with the governed robot', async () => {
        const response = await request(app)
            .post('/api/agent-prototypes')
            .set('Authorization', `Bearer ${accessToken}`)
            .set('X-Robot-Id', 'AR_001')
            .send({
                name: 'Authorized agent',
                role: 'Assistant',
                systemPrompt: 'Valid creator',
                llmProvider: 'Gemini',
                llmModel: 'gemini-2.0',
                robotId: 'AR_001',
                capabilities: [],
                tools: []
            });

        expect(response.status).toBe(201);
        expect(response.body.robotId).toBe('AR_001');
    });

    it('refuses instance creation from prototype for an unauthorized actor robot', async () => {
        const response = await request(app)
            .post(`/api/workflows/${workflow.id}/instances/from-prototype`)
            .set('Authorization', `Bearer ${accessToken}`)
            .set('X-Robot-Id', 'BO_002')
            .send({
                prototypeId: prototype.id,
                position: { x: 30, y: 40 }
            });

        expect(response.status).toBe(403);
        expect(response.body.code).toBe('ROBOT_POLICY_DENIED');
    });

    it('refuses instance update when actor robot does not match governance policy', async () => {
        const response = await request(app)
            .put(`/api/agent-instances/${instance.id}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .set('X-Robot-Id', 'BO_002')
            .send({
                name: 'Updated name'
            });

        expect(response.status).toBe(403);
        expect(response.body.code).toBe('ROBOT_POLICY_DENIED');
    });

    it('allows instance deletion for the governed robot actor', async () => {
        const response = await request(app)
            .delete(`/api/agent-instances/${instance.id}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .set('X-Robot-Id', 'AR_001');

        expect(response.status).toBe(200);
        expect(response.body.message).toContain('supprim');
    });
});
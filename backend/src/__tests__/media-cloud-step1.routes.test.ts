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

describe('MEDIA Step 1 cloud contract hardening', () => {
    let user: any;
    let accessToken: string;
    let workflow: any;
    let prototype: any;
    let instance: any;

    beforeEach(async () => {
        user = await User.create({
            email: `media-cloud-step1-${Date.now()}@test.com`,
            password: TEST_ONLY_PASSWORD,
            username: `mcs${Date.now()}`,
        });

        accessToken = generateAccessToken({
            sub: user.id,
            email: user.email,
            role: user.role,
        });

        workflow = await Workflow.create({
            userId: user.id,
            name: 'Media Cloud Step 1 workflow',
        });

        prototype = await AgentPrototype.create({
            userId: user.id,
            workflowId: workflow.id,
            name: 'Prototype cloud',
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
            name: 'Instance cloud',
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
                saveMedia: true,
                mediaStorage: 'db',
            },
        });
    });

    afterEach(async () => {
        await User.deleteMany({ _id: user._id });
    });

    it('persists cloudConnectionProfileId inside prototype persistenceConfig on create', async () => {
        const response = await request(app)
            .post('/api/agent-prototypes')
            .set('Authorization', `Bearer ${accessToken}`)
            .set('X-Robot-Id', 'AR_001')
            .send({
                name: 'Prototype cloud profile',
                role: 'Assistant',
                systemPrompt: 'Valid creator',
                llmProvider: 'Gemini',
                llmModel: 'gemini-2.0',
                robotId: 'AR_001',
                capabilities: [],
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
            });

        expect(response.status).toBe(201);
        expect(response.body.persistenceConfig).toEqual(expect.objectContaining({
            mediaStorage: 'cloud',
            cloudConnectionProfileId: 'cloud-profile-1',
        }));
    });

    it('updates prototype persistenceConfig cloudConnectionProfileId', async () => {
        const response = await request(app)
            .put(`/api/agent-prototypes/${prototype.id}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .set('X-Robot-Id', 'AR_001')
            .send({
                persistenceConfig: {
                    saveChat: true,
                    saveErrors: true,
                    saveHistorySummary: false,
                    saveLinks: false,
                    saveTasks: false,
                    saveMedia: true,
                    mediaStorage: 'cloud',
                    allowWorkspaceWrite: true,
                    cloudConnectionProfileId: 'cloud-profile-2',
                },
            });

        expect(response.status).toBe(200);
        expect(response.body.persistenceConfig).toEqual(expect.objectContaining({
            mediaStorage: 'cloud',
            cloudConnectionProfileId: 'cloud-profile-2',
        }));
    });

    it('inherits cloudConnectionProfileId when creating an instance from a prototype', async () => {
        await AgentPrototype.findByIdAndUpdate(prototype.id, {
            persistenceConfig: {
                saveChat: true,
                saveErrors: true,
                saveHistorySummary: false,
                saveLinks: false,
                saveTasks: false,
                saveMedia: true,
                allowWorkspaceWrite: true,
                mediaStorage: 'cloud',
                cloudConnectionProfileId: 'cloud-profile-inherited',
            },
        });

        const response = await request(app)
            .post(`/api/workflows/${workflow.id}/instances/from-prototype`)
            .set('Authorization', `Bearer ${accessToken}`)
            .set('X-Robot-Id', 'AR_001')
            .send({
                prototypeId: prototype.id,
                position: { x: 30, y: 40 },
            });

        expect(response.status).toBe(201);
        expect(response.body.persistenceConfig).toEqual(expect.objectContaining({
            mediaStorage: 'cloud',
            cloudConnectionProfileId: 'cloud-profile-inherited',
        }));
    });

    it('rejects legacy cloudStorageConfig ingress on instance update', async () => {
        const response = await request(app)
            .put(`/api/agent-instances/${instance.id}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .set('X-Robot-Id', 'AR_001')
            .send({
                persistenceConfig: {
                    saveMedia: true,
                    mediaStorage: 'cloud',
                    cloudStorageConfig: {
                        provider: 's3',
                        bucketName: 'legacy-bucket',
                    },
                },
            });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Validation échouée');
    });
});
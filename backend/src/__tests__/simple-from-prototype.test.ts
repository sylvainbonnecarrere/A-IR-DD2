// Test simple et isolé pour /from-prototype
import request from 'supertest';
import express from 'express';
import '../middleware/auth.middleware';
import passport from 'passport';
import { User } from '../models/User.model';
import { Workflow } from '../models/Workflow.model';
import { AgentPrototype } from '../models/AgentPrototype.model';
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

    beforeAll(async () => {
        // Create user
        user = await User.create({
            email: `test-simple-${Date.now()}@test.com`,
            password: TEST_ONLY_PASSWORD,
            username: `user${Date.now()}`
        });

        token = generateAccessToken({ sub: user.id, email: user.email, role: user.role });

        // Create workflow
        workflow = await Workflow.create({
            userId: user.id,
            name: 'Test Workflow'
        });

        // Create prototype
        prototype = await AgentPrototype.create({
            userId: user.id,
            name: 'Test Proto',
            role: 'Test',
            systemPrompt: 'Test prompt',
            llmProvider: 'Gemini',
            llmModel: 'gemini-2.0',
            robotId: 'AR_001'
        });
    }, 30000);

    afterAll(async () => {
        await User.deleteOne({ _id: user._id });
    });

    it('POST /from-prototype should create instance', async () => {
        const res = await request(app)
            .post(`/api/workflows/${workflow.id}/instances/from-prototype`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                prototypeId: prototype.id,
                position: { x: 10, y: 20 }
            });

        console.log('Response status:', res.status);
        console.log('Response body:', JSON.stringify(res.body));

        expect(res.status).toBe(201);
        expect(res.body.id).toBeDefined();
        expect(res.body.name).toBe('Test Proto');
    });
});

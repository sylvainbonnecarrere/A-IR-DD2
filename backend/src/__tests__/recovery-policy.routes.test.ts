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
app.use('/api/agent-prototypes', agentPrototypesRoutes);
app.use('/api/workflows/:workflowId/instances', agentInstancesRoutes);

function prototypePayload(overrides: Record<string, unknown> = {}) {
    return {
        name: 'Proto J7-08',
        role: 'Assistant',
        systemPrompt: 'Prompt',
        llmProvider: 'Gemini',
        llmModel: 'gemini-2.0',
        robotId: 'AR_001',
        ...overrides,
    };
}

describe('recoveryPolicy routes (US-J7-08)', () => {
    let user: any;
    let token: string;
    let workflow: any;
    let workflowId: string;

    beforeAll(async () => {
        user = await User.create({
            email: `recovery-policy-${Date.now()}@test.com`,
            password: TEST_ONLY_PASSWORD,
            username: `rp${Date.now()}`,
        });
        token = generateAccessToken({ sub: user.id, email: user.email, role: user.role });
    }, 30000);

    beforeEach(async () => {
        workflow = await Workflow.create({ userId: user.id, name: 'Workflow J7-08' });
        workflowId = workflow.id;
    });

    afterAll(async () => {
        await AgentInstance.deleteMany({ userId: user._id });
        await AgentPrototype.deleteMany({ userId: user._id });
        await Workflow.deleteMany({ userId: user._id });
        await User.deleteOne({ _id: user._id });
    });

    it('persists recoveryPolicy on prototype creation', async () => {
        const res = await request(app)
            .post('/api/agent-prototypes')
            .set('Authorization', `Bearer ${token}`)
            .send(prototypePayload({ recoveryPolicy: { autoFenceAndRetry: true, maxAttempts: 3 } }));

        expect(res.status).toBe(201);
        expect(res.body.recoveryPolicy).toEqual({ autoFenceAndRetry: true, maxAttempts: 3 });

        const stored = await AgentPrototype.findById(res.body._id ?? res.body.id).lean();
        expect(stored?.recoveryPolicy).toEqual({ autoFenceAndRetry: true, maxAttempts: 3 });
    });

    it('defaults recoveryPolicy to off when omitted on prototype creation', async () => {
        const res = await request(app)
            .post('/api/agent-prototypes')
            .set('Authorization', `Bearer ${token}`)
            .send(prototypePayload());

        expect(res.status).toBe(201);
        expect(res.body.recoveryPolicy).toEqual({ autoFenceAndRetry: false, maxAttempts: 0 });
    });

    it('rejects an invalid recoveryPolicy with 400', async () => {
        const res = await request(app)
            .post('/api/agent-prototypes')
            .set('Authorization', `Bearer ${token}`)
            .send(prototypePayload({ recoveryPolicy: { autoFenceAndRetry: true, maxAttempts: 99 } }));

        expect(res.status).toBe(400);

        const resExtra = await request(app)
            .post('/api/agent-prototypes')
            .set('Authorization', `Bearer ${token}`)
            .send(prototypePayload({ recoveryPolicy: { autoFenceAndRetry: true, maxAttempts: 1, hack: true } }));

        expect(resExtra.status).toBe(400);
    });

    it('snapshots the prototype recoveryPolicy on instance created from-prototype', async () => {
        const prototype = await AgentPrototype.create({
            userId: user.id,
            workflowId: workflow.id,
            ...prototypePayload({ name: 'Proto snapshot' }),
            recoveryPolicy: { autoFenceAndRetry: true, maxAttempts: 2 },
        });

        const res = await request(app)
            .post(`/api/workflows/${workflowId}/instances/from-prototype`)
            .set('Authorization', `Bearer ${token}`)
            .send({ prototypeId: prototype.id, position: { x: 0, y: 0 } });

        expect(res.status).toBe(201);

        const instance = await AgentInstance.findById(res.body._id ?? res.body.id).lean();
        expect(instance?.recoveryPolicy).toEqual({ autoFenceAndRetry: true, maxAttempts: 2 });
    });

    it('lets the frontend configuration_json override the prototype recoveryPolicy snapshot', async () => {
        const prototype = await AgentPrototype.create({
            userId: user.id,
            workflowId: workflow.id,
            ...prototypePayload({ name: 'Proto override' }),
            recoveryPolicy: { autoFenceAndRetry: true, maxAttempts: 2 },
        });

        const res = await request(app)
            .post(`/api/workflows/${workflowId}/instances/from-prototype`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                prototypeId: prototype.id,
                position: { x: 0, y: 0 },
                configuration_json: { recoveryPolicy: { autoFenceAndRetry: false, maxAttempts: 0 } },
            });

        expect(res.status).toBe(201);

        const instance = await AgentInstance.findById(res.body._id ?? res.body.id).lean();
        expect(instance?.recoveryPolicy).toEqual({ autoFenceAndRetry: false, maxAttempts: 0 });
    });

    it('snapshots the default off policy when neither prototype nor frontend provide one', async () => {
        const prototype = await AgentPrototype.create({
            userId: user.id,
            workflowId: workflow.id,
            ...prototypePayload({ name: 'Proto default' }),
        });
        await AgentPrototype.updateOne({ _id: prototype._id }, { $unset: { recoveryPolicy: '' } });

        const res = await request(app)
            .post(`/api/workflows/${workflowId}/instances/from-prototype`)
            .set('Authorization', `Bearer ${token}`)
            .send({ prototypeId: prototype.id, position: { x: 0, y: 0 } });

        expect(res.status).toBe(201);

        const instance = await AgentInstance.findById(res.body._id ?? res.body.id).lean();
        expect(instance?.recoveryPolicy).toEqual({ autoFenceAndRetry: false, maxAttempts: 0 });
    });
});

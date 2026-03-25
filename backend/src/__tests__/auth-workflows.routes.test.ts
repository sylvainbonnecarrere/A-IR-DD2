import express from 'express';
import mongoose from 'mongoose';
import passport from 'passport';
import request from 'supertest';
import '../middleware/auth.middleware';
import authRoutes from '../routes/auth.routes';
import workflowsRoutes from '../routes/workflows.routes';
import { User } from '../models/User.model';
import { Workflow } from '../models/Workflow.model';
import { generateAccessToken } from '../utils/jwt';

const app = express();
app.use(express.json());
app.use(passport.initialize());
app.use('/api/auth', authRoutes);
app.use('/api/workflows', workflowsRoutes);

async function cleanupAuthWorkflowFixtures() {
    const users = await User.find({ email: /auth-workflow-route-/i }).select('_id').lean();
    const userIds = users.map((user) => user._id);

    if (userIds.length > 0) {
        await Workflow.deleteMany({ userId: { $in: userIds } });
    }

    await User.deleteMany({ email: /auth-workflow-route-/i });
}

async function createUserFixture(label: string) {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const user = await User.create({
        email: `auth-workflow-route-${label}-${suffix}@test.com`,
        password: 'Password123',
        username: `authworkflow${label}${suffix}`,
        role: 'user',
        isActive: true
    });

    const accessToken = generateAccessToken({
        sub: user.id,
        email: user.email,
        role: user.role
    });

    return { user, accessToken };
}

describe('Auth and workflow routes', () => {
    afterEach(async () => {
        await cleanupAuthWorkflowFixtures();
    });

    it('registers a user and creates a default workflow immediately', async () => {
        const response = await request(app)
            .post('/api/auth/register')
            .send({
                email: `auth-workflow-route-register-${Date.now()}@test.com`,
                password: 'Password123'
            })
            .expect(201);

        expect(response.body.user).toEqual(expect.objectContaining({
            email: expect.stringMatching(/auth-workflow-route-register-/i),
            role: 'user'
        }));
        expect(response.body.accessToken).toEqual(expect.any(String));
        expect(response.body.refreshToken).toEqual(expect.any(String));

        const persistedUser = await User.findOne({ email: response.body.user.email });
        expect(persistedUser).not.toBeNull();
        expect(persistedUser?.defaultWorkflowId).toBeDefined();
        expect(persistedUser?.workflowCount).toBe(1);

        const workflows = await Workflow.find({ userId: persistedUser?._id }).lean();
        expect(workflows).toHaveLength(1);
        expect(workflows[0]).toEqual(expect.objectContaining({
            name: 'Mon Workflow',
            isActive: true,
            isDefault: true
        }));
    });

    it('logs in an existing user and refreshes an access token', async () => {
        const fixture = await createUserFixture('login');

        const loginResponse = await request(app)
            .post('/api/auth/login')
            .send({
                email: fixture.user.email,
                password: 'Password123'
            })
            .expect(200);

        expect(loginResponse.body.user).toEqual(expect.objectContaining({
            id: fixture.user.id,
            email: fixture.user.email,
            role: 'user',
            lastLogin: expect.any(String)
        }));
        expect(loginResponse.body.accessToken).toEqual(expect.any(String));
        expect(loginResponse.body.refreshToken).toEqual(expect.any(String));

        const refreshedUser = await User.findById(fixture.user._id).lean();
        expect(refreshedUser?.lastLogin).toBeInstanceOf(Date);

        const refreshResponse = await request(app)
            .post('/api/auth/refresh')
            .send({ refreshToken: loginResponse.body.refreshToken })
            .expect(200);

        expect(refreshResponse.body.accessToken).toEqual(expect.any(String));
    });

    it('requires authentication for workflow listing', async () => {
        await request(app)
            .get('/api/workflows')
            .expect(401);
    });

    it('self-heals a missing default workflow on authenticated listing', async () => {
        const fixture = await createUserFixture('self-heal');

        const response = await request(app)
            .get('/api/workflows')
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .expect(200);

        expect(response.body.workflows).toHaveLength(1);
        expect(response.body.workflows[0]).toEqual(expect.objectContaining({
            name: 'Mon Workflow',
            isActive: true,
            isDefault: true,
            agentCount: 0
        }));

        const persistedUser = await User.findById(fixture.user._id).lean();
        expect(persistedUser?.defaultWorkflowId?.toString()).toBe(response.body.workflows[0]._id);
        expect(persistedUser?.lastActiveWorkflowId?.toString()).toBe(response.body.workflows[0]._id);
        expect(persistedUser?.workflowCount).toBe(1);
    });

    it('rejects access to another user workflow', async () => {
        const owner = await createUserFixture('owner');
        const intruder = await createUserFixture('intruder');
        const workflow = await Workflow.create({
            userId: owner.user._id,
            name: 'Auth route owned workflow',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 }
        });

        const response = await request(app)
            .get(`/api/workflows/${workflow.id}`)
            .set('Authorization', `Bearer ${intruder.accessToken}`)
            .expect(403);

        expect(response.body.error).toBe('Accès non autorisé à cette ressource');
    });

    it('rejects placeholder workflow ids before ownership checks on update', async () => {
        const fixture = await createUserFixture('placeholder');

        const response = await request(app)
            .put('/api/workflows/default-workflow')
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .send({ name: 'Should fail' })
            .expect(400);

        expect(response.body).toEqual(expect.objectContaining({
            error: 'Invalid workflow ID',
            code: 'INVALID_WORKFLOW_ID'
        }));
    });

    it('updates the selected workflow and synchronizes the user default pointers', async () => {
        const fixture = await createUserFixture('select');
        const firstWorkflow = await Workflow.create({
            userId: fixture.user._id,
            name: 'Auth route first workflow',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 }
        });
        const secondWorkflow = await Workflow.create({
            userId: fixture.user._id,
            name: 'Auth route second workflow',
            isActive: false,
            isDefault: false,
            canvasState: { zoom: 1, panX: 0, panY: 0 }
        });

        await User.findByIdAndUpdate(fixture.user._id, {
            defaultWorkflowId: firstWorkflow._id,
            lastActiveWorkflowId: firstWorkflow._id,
            workflowCount: 2
        });

        const response = await request(app)
            .post(`/api/workflows/${secondWorkflow.id}/select`)
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .expect(200);

        expect(response.body).toEqual(expect.objectContaining({
            success: true,
            workflow: expect.objectContaining({
                _id: secondWorkflow.id,
                isActive: true,
                isDefault: true
            }),
            reloadedData: expect.objectContaining({
                workflow: expect.objectContaining({
                    id: secondWorkflow.id
                })
            })
        }));

        const [persistedFirst, persistedSecond, persistedUser] = await Promise.all([
            Workflow.findById(firstWorkflow._id).lean(),
            Workflow.findById(secondWorkflow._id).lean(),
            User.findById(fixture.user._id).lean()
        ]);

        expect(persistedFirst).toEqual(expect.objectContaining({
            isActive: false,
            isDefault: false
        }));
        expect(persistedSecond).toEqual(expect.objectContaining({
            isActive: true,
            isDefault: true
        }));
        expect(persistedUser?.defaultWorkflowId?.toString()).toBe(secondWorkflow.id);
        expect(persistedUser?.lastActiveWorkflowId?.toString()).toBe(secondWorkflow.id);
    });
});
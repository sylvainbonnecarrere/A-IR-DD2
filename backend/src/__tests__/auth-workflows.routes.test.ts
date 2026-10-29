import express from 'express';
import mongoose from 'mongoose';
import passport from 'passport';
import request from 'supertest';
import '../middleware/auth.middleware';
import authRoutes from '../routes/auth.routes';
import workflowsRoutes from '../routes/workflows.routes';
import { AgentInstance } from '../models/AgentInstance.model';
import { AgentJournal } from '../models/AgentJournal.model';
import { WorkflowEdge } from '../models/WorkflowEdge.model';
import { WorkflowNodeV2 } from '../models/WorkflowNodeV2.model';
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
        await AgentJournal.deleteMany({ workflowId: { $in: userIds } });
        await AgentInstance.deleteMany({ workflowId: { $in: userIds } });
        await WorkflowEdge.deleteMany({ workflowId: { $in: userIds } });
        await WorkflowNodeV2.deleteMany({ workflowId: { $in: userIds } });
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
        expect(persistedUser?.password).toBeUndefined();
        expect(persistedUser?.defaultWorkflowId).toBeDefined();
        expect(persistedUser?.workflowCount).toBe(1);

        const persistedUserWithPassword = await User.findOne({ email: response.body.user.email }).select('+password').lean();
        expect(persistedUserWithPassword?.password).toEqual(expect.any(String));
        expect(persistedUserWithPassword?.password).not.toBe('Password123');

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
        expect(response.body.code).toBe('OWNERSHIP_DENIED');
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

    it('updates a workflow and synchronizes exclusivity rules for active and default flags', async () => {
        const fixture = await createUserFixture('update');
        const firstWorkflow = await Workflow.create({
            userId: fixture.user._id,
            name: 'Auth route update first workflow',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 }
        });
        const secondWorkflow = await Workflow.create({
            userId: fixture.user._id,
            name: 'Auth route update second workflow',
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
            .put(`/api/workflows/${secondWorkflow.id}`)
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .send({
                name: 'Workflow promoted',
                isActive: true,
                isDefault: true
            })
            .expect(200);

        expect(response.body).toEqual(expect.objectContaining({
            _id: secondWorkflow.id,
            name: 'Workflow promoted',
            isActive: true,
            isDefault: true
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
            name: 'Workflow promoted',
            isActive: true,
            isDefault: true
        }));
        expect(persistedUser?.defaultWorkflowId?.toString()).toBe(secondWorkflow.id);
        expect(persistedUser?.lastActiveWorkflowId?.toString()).toBe(secondWorkflow.id);
    });

    it('returns a permanent deprecation response for legacy V1 workflow mutation routes', async () => {
        const fixture = await createUserFixture('legacy-route');
        const workflow = await Workflow.create({
            userId: fixture.user._id,
            name: 'Legacy header workflow',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 }
        });

        const response = await request(app)
            .patch(`/api/workflows/${workflow.id}/nodes/missing-node/position`)
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .send({ x: 10, y: 20 })
            .expect(410);

        expect(response.headers.warning).toContain('Deprecated workflow V1 route');
        expect(response.headers['x-workflow-legacy-route']).toBe('nodePositionPatch');
        expect(response.body).toEqual(expect.objectContaining({
            code: 'WORKFLOW_V1_ENDPOINT_DEPRECATED',
            error: 'Workflow V1 legacy endpoint is no longer available',
            workflowId: workflow.id,
            route: 'nodePositionPatch',
        }));
        expect(Number(response.headers['x-workflow-legacy-count'])).toBeGreaterThanOrEqual(1);
    });

    it('saves a workflow and clears its dirty flag', async () => {
        const fixture = await createUserFixture('save');
        const workflow = await Workflow.create({
            userId: fixture.user._id,
            name: 'Workflow to save',
            isActive: true,
            isDefault: true,
            isDirty: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 }
        });

        const response = await request(app)
            .post(`/api/workflows/${workflow.id}/save`)
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .expect(200);

        expect(response.body).toEqual(expect.objectContaining({
            message: 'Workflow sauvegardé',
            lastSavedAt: expect.any(String)
        }));

        const persistedWorkflow = await Workflow.findById(workflow._id).lean();
        expect(persistedWorkflow?.isDirty).toBe(false);
        expect(persistedWorkflow?.lastSavedAt).toBeInstanceOf(Date);
    });

    it('marks a workflow as dirty through the dedicated route', async () => {
        const fixture = await createUserFixture('dirty');
        const workflow = await Workflow.create({
            userId: fixture.user._id,
            name: 'Workflow to dirty',
            isActive: true,
            isDefault: true,
            isDirty: false,
            canvasState: { zoom: 1, panX: 0, panY: 0 }
        });

        await request(app)
            .post(`/api/workflows/${workflow.id}/mark-dirty`)
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .expect(200);

        const persistedWorkflow = await Workflow.findById(workflow._id).lean();
        expect(persistedWorkflow?.isDirty).toBe(true);
    });

    it('patches a workflow atomically and detects version conflicts', async () => {
        const fixture = await createUserFixture('patch');
        const workflow = await Workflow.create({
            userId: fixture.user._id,
            name: 'Workflow to patch',
            description: 'before',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 }
        });
        const initialVersion = workflow.__v ?? 0;

        const patchResponse = await request(app)
            .patch(`/api/workflows/${workflow.id}/patch`)
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .send({
                $set: { description: 'after' },
                expectedVersion: initialVersion
            })
            .expect(200);

        expect(patchResponse.body).toEqual(expect.objectContaining({
            success: true,
            version: initialVersion + 1
        }));

        await request(app)
            .patch(`/api/workflows/${workflow.id}/patch`)
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .send({
                $set: { description: 'stale' },
                expectedVersion: initialVersion
            })
            .expect(409);

        const persistedWorkflow = await Workflow.findById(workflow._id).lean();
        expect(persistedWorkflow?.description).toBe('after');
    });

    it('deletes a workflow, reassigns default ownership, and updates the user counters', async () => {
        const fixture = await createUserFixture('delete');
        const firstWorkflow = await Workflow.create({
            userId: fixture.user._id,
            name: 'Workflow delete first',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 }
        });
        const secondWorkflow = await Workflow.create({
            userId: fixture.user._id,
            name: 'Workflow delete second',
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
            .delete(`/api/workflows/${firstWorkflow.id}`)
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .expect(200);

        expect(response.body).toEqual(expect.objectContaining({
            success: true,
            deletedWorkflowId: firstWorkflow.id,
            cascade: expect.objectContaining({
                agentsDeleted: 0,
                edgesDeleted: 0,
                nodesDeleted: 0,
                journalsDeleted: 0,
            })
        }));

        const [deletedWorkflow, persistedSecond, persistedUser] = await Promise.all([
            Workflow.findById(firstWorkflow._id).lean(),
            Workflow.findById(secondWorkflow._id).lean(),
            User.findById(fixture.user._id).lean()
        ]);

        expect(deletedWorkflow).toBeNull();
        expect(persistedSecond).toEqual(expect.objectContaining({
            isActive: true,
            isDefault: true,
        }));
        expect(persistedUser?.defaultWorkflowId?.toString()).toBe(secondWorkflow.id);
        expect(persistedUser?.lastActiveWorkflowId?.toString()).toBe(secondWorkflow.id);
        expect(persistedUser?.workflowCount).toBe(1);
    });

    it('rejects deletion when the workflow is the user last remaining workflow', async () => {
        const fixture = await createUserFixture('delete-last');
        const workflow = await Workflow.create({
            userId: fixture.user._id,
            name: 'Last workflow',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 }
        });
        await User.findByIdAndUpdate(fixture.user._id, {
            defaultWorkflowId: workflow._id,
            lastActiveWorkflowId: workflow._id,
            workflowCount: 1
        });

        const response = await request(app)
            .delete(`/api/workflows/${workflow.id}`)
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .expect(400);

        expect(response.body).toEqual(expect.objectContaining({
            code: 'LAST_WORKFLOW',
            error: 'Impossible de supprimer le seul workflow'
        }));
    });

    it('self-heals stale agent-instance references before activation when the workflow graph is otherwise valid', async () => {
        const fixture = await createUserFixture('self-heal-invalid-node');
        const workflow = await Workflow.create({
            userId: fixture.user._id,
            name: 'Self-heal workflow',
            isActive: false,
            isDefault: false,
            canvasState: { zoom: 1, panX: 0, panY: 0 }
        });

        const staleInstanceId = new mongoose.Types.ObjectId();
        await WorkflowNodeV2.create({
            workflowId: workflow._id,
            ownerId: fixture.user._id,
            nodeType: 'agent',
            instanceId: staleInstanceId,
            position: { x: 10, y: 20 },
            uiConfig: { label: 'Broken agent node', expanded: true }
        });

        const response = await request(app)
            .post(`/api/workflows/${workflow.id}/select`)
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.workflow).toEqual(expect.objectContaining({
            isActive: true,
            isDefault: true,
        }));
        expect(await WorkflowNodeV2.countDocuments({ workflowId: workflow._id })).toBe(0);
    });

    it('rejects workflow activation when the V2 graph contains an invalid agent node reference', async () => {
        const fixture = await createUserFixture('invalid-select');
        const workflow = await Workflow.create({
            userId: fixture.user._id,
            name: 'Invalid activation workflow',
            isActive: false,
            isDefault: false,
            canvasState: { zoom: 1, panX: 0, panY: 0 }
        });

        await WorkflowNodeV2.create({
            workflowId: workflow._id,
            ownerId: fixture.user._id,
            nodeType: 'agent',
            position: { x: 10, y: 20 },
            uiConfig: { label: 'Broken agent node', expanded: true }
        });

        const response = await request(app)
            .post(`/api/workflows/${workflow.id}/select`)
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .expect(422);

        expect(response.body).toEqual(expect.objectContaining({
            error: 'Workflow IR invalide',
            code: 'INVALID_WORKFLOW_IR',
            issues: expect.arrayContaining([
                expect.objectContaining({ code: 'MISSING_AGENT_INSTANCE' })
            ])
        }));
    });

    it('rejects workflow activation through update when the V2 graph contains a cycle', async () => {
        const fixture = await createUserFixture('invalid-update');
        const workflow = await Workflow.create({
            userId: fixture.user._id,
            name: 'Invalid update workflow',
            isActive: false,
            isDefault: false,
            canvasState: { zoom: 1, panX: 0, panY: 0 }
        });
        const sourceInstanceId = new mongoose.Types.ObjectId();
        const targetInstanceId = new mongoose.Types.ObjectId();

        await AgentInstance.create([
            {
                workflowId: workflow._id,
                userId: fixture.user._id,
                prototypeId: new mongoose.Types.ObjectId(),
                executionId: new mongoose.Types.ObjectId().toString(),
                status: 'running',
                name: 'A',
                role: 'assistant',
                systemPrompt: 'assistant',
                llmProvider: 'openai',
                llmModel: 'gpt-4o-mini',
                capabilities: [],
                robotId: 'AR_001',
                position: { x: 10, y: 20 },
                isMinimized: false,
                isMaximized: false,
                zIndex: 0,
                metrics: { totalTokens: 0, totalErrors: 0, totalMediaGenerated: 0, callCount: 0 },
                persistenceConfig: { saveChat: true, saveErrors: true, saveHistorySummary: false, saveLinks: false, saveTasks: false, saveMedia: false, allowWorkspaceWrite: false, mediaStorage: 'db', cloudStorageConfig: null },
                _id: sourceInstanceId,
            },
            {
                workflowId: workflow._id,
                userId: fixture.user._id,
                prototypeId: new mongoose.Types.ObjectId(),
                executionId: new mongoose.Types.ObjectId().toString(),
                status: 'running',
                name: 'B',
                role: 'assistant',
                systemPrompt: 'assistant',
                llmProvider: 'openai',
                llmModel: 'gpt-4o-mini',
                capabilities: [],
                robotId: 'AR_001',
                position: { x: 30, y: 40 },
                isMinimized: false,
                isMaximized: false,
                zIndex: 0,
                metrics: { totalTokens: 0, totalErrors: 0, totalMediaGenerated: 0, callCount: 0 },
                persistenceConfig: { saveChat: true, saveErrors: true, saveHistorySummary: false, saveLinks: false, saveTasks: false, saveMedia: false, allowWorkspaceWrite: false, mediaStorage: 'db', cloudStorageConfig: null },
                _id: targetInstanceId,
            }
        ]);

        await WorkflowNodeV2.create([
            {
                workflowId: workflow._id,
                ownerId: fixture.user._id,
                nodeType: 'agent',
                instanceId: sourceInstanceId,
                position: { x: 10, y: 20 },
                uiConfig: { label: 'A', expanded: true }
            },
            {
                workflowId: workflow._id,
                ownerId: fixture.user._id,
                nodeType: 'agent',
                instanceId: targetInstanceId,
                position: { x: 30, y: 40 },
                uiConfig: { label: 'B', expanded: true }
            }
        ]);

        await WorkflowEdge.create([
            {
                workflowId: workflow._id,
                userId: fixture.user._id,
                sourceInstanceId,
                targetInstanceId,
                edgeType: 'default',
                animated: false
            },
            {
                workflowId: workflow._id,
                userId: fixture.user._id,
                sourceInstanceId: targetInstanceId,
                targetInstanceId: sourceInstanceId,
                edgeType: 'default',
                animated: false
            }
        ]);

        const response = await request(app)
            .put(`/api/workflows/${workflow.id}`)
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .send({ isActive: true })
            .expect(422);

        expect(response.body).toEqual(expect.objectContaining({
            error: 'Workflow IR invalide',
            code: 'INVALID_WORKFLOW_IR',
            issues: expect.arrayContaining([
                expect.objectContaining({ code: 'CYCLE_DETECTED' })
            ])
        }));
    });
});
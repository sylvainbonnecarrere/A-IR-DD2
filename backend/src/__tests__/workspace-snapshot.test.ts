import express from 'express';
import mongoose from 'mongoose';
import passport from 'passport';
import request from 'supertest';
import '../middleware/auth.middleware';
import { User } from '../models/User.model';
import { Workflow } from '../models/Workflow.model';
import { AgentPrototype } from '../models/AgentPrototype.model';
import { AgentInstance } from '../models/AgentInstance.model';
import { WorkflowEdge } from '../models/WorkflowEdge.model';
import { AgentJournal } from '../models/AgentJournal.model';
import userWorkspaceRoutes from '../routes/user-workspace.routes';
import workflowsRoutes from '../routes/workflows.routes';
import { generateAccessToken } from '../utils/jwt';

const app = express();
app.use(express.json());
app.use(passport.initialize());
app.use('/api/user', userWorkspaceRoutes);
app.use('/api/workflows', workflowsRoutes);

interface SnapshotFixture {
    userId: string;
    accessToken: string;
    workflowId: string;
    sourceInstanceId: string;
    targetInstanceId: string;
}

async function createSnapshotFixture(): Promise<SnapshotFixture> {
    const user = await User.create({
        email: `snapshot-${Date.now()}-${Math.random()}@test.com`,
        password: 'hashedpassword12345',
        username: `snapshot${Date.now()}${Math.floor(Math.random() * 1000)}`,
        defaultWorkflowId: null,
        lastActiveWorkflowId: null
    });

    const workflow = await Workflow.create({
        userId: user.id,
        name: 'Snapshot Workflow',
        description: 'Hydration test',
        isActive: true,
        isDefault: true,
        canvasState: { zoom: 1.25, panX: 12, panY: 24 }
    });

    await User.findByIdAndUpdate(user.id, {
        defaultWorkflowId: workflow._id,
        lastActiveWorkflowId: workflow._id,
        workflowCount: 1
    });

    const prototype = await AgentPrototype.create({
        userId: user.id,
        workflowId: workflow.id,
        name: 'Snapshot Agent',
        role: 'assistant',
        systemPrompt: 'Restore me exactly',
        llmProvider: 'Gemini',
        llmModel: 'gemini-2.0-flash',
        capabilities: ['Chat'],
        tools: [],
        robotId: 'AR_001'
    });

    const baseInstance = {
        workflowId: workflow.id,
        userId: user.id,
        prototypeId: prototype._id,
        role: 'assistant',
        systemPrompt: 'Restore me exactly',
        llmProvider: 'Gemini',
        llmModel: 'gemini-2.0-flash',
        capabilities: ['Chat'],
        tools: [],
        robotId: 'AR_001',
        position: { x: 120, y: 180 },
        content: [],
        metrics: {
            totalTokens: 10,
            totalErrors: 0,
            totalMediaGenerated: 0,
            callCount: 1
        },
        persistenceConfig: {
            saveChat: true,
            saveErrors: true,
            saveHistorySummary: false,
            saveLinks: false,
            saveTasks: false,
            saveMedia: true,
            mediaStorage: 'db'
        }
    };

    const sourceInstance = await AgentInstance.create({
        ...baseInstance,
        name: 'Source Agent',
        executionId: `exec-${new mongoose.Types.ObjectId().toString()}`,
        status: 'completed'
    });
    const targetInstance = await AgentInstance.create({
        ...baseInstance,
        name: 'Target Agent',
        executionId: `exec-${new mongoose.Types.ObjectId().toString()}`,
        status: 'running',
        position: { x: 420, y: 180 }
    });

    await WorkflowEdge.create({
        workflowId: workflow.id,
        userId: user.id,
        sourceInstanceId: sourceInstance.id,
        targetInstanceId: targetInstance.id,
        edgeType: 'smoothstep',
        label: 'handoff'
    });

    await AgentJournal.create({
        workflowId: workflow.id,
        agentInstanceId: sourceInstance.id,
        type: 'chat',
        severity: 'info',
        timestamp: new Date(),
        payload: {
            role: 'agent',
            content: 'restored message',
            imageBase64: 'ZmFrZS1pbWFnZQ==',
            mimeType: 'image/png',
            fileName: 'proof.png'
        }
    });

    return {
        userId: user.id,
        accessToken: generateAccessToken({
            sub: user.id,
            email: user.email,
            role: user.role
        }),
        workflowId: workflow.id,
        sourceInstanceId: sourceInstance.id,
        targetInstanceId: targetInstance.id
    };
}

async function cleanupSnapshotFixture(fixture: SnapshotFixture) {
    await AgentJournal.deleteMany({ workflowId: fixture.workflowId });
    await WorkflowEdge.deleteMany({ workflowId: fixture.workflowId });
    await AgentInstance.deleteMany({ workflowId: fixture.workflowId });
    await AgentPrototype.deleteMany({ workflowId: fixture.workflowId });
    await Workflow.deleteMany({ _id: fixture.workflowId });
    await User.deleteMany({ _id: fixture.userId });
}

describe('Workspace snapshot contract', () => {
    let fixture: SnapshotFixture;

    beforeEach(async () => {
        fixture = await createSnapshotFixture();
    });

    afterEach(async () => {
        await cleanupSnapshotFixture(fixture);
    });

    it('returns a unified snapshot from GET /api/user/workspace', async () => {
        const response = await request(app)
            .get('/api/user/workspace')
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .expect(200);

        expect(response.body.workflow.id).toBe(fixture.workflowId);
        expect(response.body.edges).toContainEqual(expect.objectContaining({
            source: `node-${fixture.sourceInstanceId}`,
            target: `node-${fixture.targetInstanceId}`,
            type: 'smoothstep'
        }));

        const restoredInstance = response.body.agentInstances.find((instance: any) => instance.id === fixture.sourceInstanceId);
        expect(restoredInstance).toBeDefined();
        expect(restoredInstance.chatMessages).toHaveLength(1);
        expect(restoredInstance.chatMessages[0]).toEqual(expect.objectContaining({
            text: 'restored message',
            image: 'ZmFrZS1pbWFnZQ==',
            mimeType: 'image/png',
            fileName: 'proof.png'
        }));
        expect(restoredInstance.configuration_json.position).toMatchObject({ x: 120, y: 180 });
    });

    it('returns the same snapshot contract from POST /api/workflows/:id/select', async () => {
        const response = await request(app)
            .post(`/api/workflows/${fixture.workflowId}/select`)
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.reloadedData.workflow.id).toBe(fixture.workflowId);
        expect(response.body.reloadedData.edges).toContainEqual(expect.objectContaining({
            source: `node-${fixture.sourceInstanceId}`,
            target: `node-${fixture.targetInstanceId}`,
            type: 'smoothstep'
        }));

        const restoredInstance = response.body.reloadedData.agentInstances.find((instance: any) => instance.id === fixture.sourceInstanceId);
        expect(restoredInstance.chatMessages[0].text).toBe('restored message');
    });
});
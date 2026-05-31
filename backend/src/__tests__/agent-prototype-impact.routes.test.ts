import request from 'supertest';
import express from 'express';
import passport from 'passport';
import '../middleware/auth.middleware';
import { User } from '../models/User.model';
import { Workflow } from '../models/Workflow.model';
import { AgentPrototype } from '../models/AgentPrototype.model';
import { AgentInstance } from '../models/AgentInstance.model';
import { WorkflowNodeV2 } from '../models/WorkflowNodeV2.model';
import agentPrototypesRoutes from '../routes/agent-prototypes.routes';
import { generateAccessToken } from '../utils/jwt';

const TEST_ONLY_PASSWORD = 'test-only-password-123';

const app = express();
app.use(express.json());
app.use(passport.initialize());
app.use('/api/agent-prototypes', agentPrototypesRoutes);

describe('GET /api/agent-prototypes/:id/impact', () => {
    let user: any;
    let accessToken: string;
    let workflow: any;
    let otherWorkflow: any;
    let prototype: any;
    let liveInstance: any;
    let otherWorkflowInstance: any;

    beforeEach(async () => {
        user = await User.create({
            email: `prototype-impact-${Date.now()}@test.com`,
            password: TEST_ONLY_PASSWORD,
            username: `pi${Date.now()}`,
        });

        accessToken = generateAccessToken({
            sub: user.id,
            email: user.email,
            role: user.role,
        });

        workflow = await Workflow.create({
            userId: user.id,
            name: 'Workflow courant',
        });

        otherWorkflow = await Workflow.create({
            userId: user.id,
            name: 'Workflow secondaire',
        });

        prototype = await AgentPrototype.create({
            userId: user.id,
            workflowId: workflow.id,
            name: 'Prototype Archi',
            role: 'Assistant',
            systemPrompt: 'Prompt',
            llmProvider: 'Gemini',
            llmModel: 'gemini-2.0',
            robotId: 'AR_001',
        });

        liveInstance = await AgentInstance.create({
            workflowId: workflow.id,
            userId: user.id,
            prototypeId: prototype.id,
            executionId: `run-live-${Date.now()}`,
            status: 'running',
            name: 'Instance live',
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

        otherWorkflowInstance = await AgentInstance.create({
            workflowId: otherWorkflow.id,
            userId: user.id,
            prototypeId: prototype.id,
            executionId: `run-other-${Date.now()}`,
            status: 'running',
            name: 'Instance autre workflow',
            role: 'Assistant',
            systemPrompt: 'Prompt',
            llmProvider: 'Gemini',
            llmModel: 'gemini-2.0',
            capabilities: [],
            robotId: 'AR_001',
            position: { x: 30, y: 40 },
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

        const deletedInstance = await AgentInstance.create({
            workflowId: workflow.id,
            userId: user.id,
            prototypeId: prototype.id,
            executionId: `run-deleted-${Date.now()}`,
            status: 'running',
            name: 'Instance supprimee',
            role: 'Assistant',
            systemPrompt: 'Prompt',
            llmProvider: 'Gemini',
            llmModel: 'gemini-2.0',
            capabilities: [],
            robotId: 'AR_001',
            position: { x: 50, y: 60 },
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

        await WorkflowNodeV2.create([
            {
                workflowId: workflow.id,
                ownerId: user.id,
                nodeType: 'agent',
                instanceId: liveInstance.id,
                position: { x: 10, y: 20 },
                uiConfig: { expanded: true },
            },
            {
                workflowId: otherWorkflow.id,
                ownerId: user.id,
                nodeType: 'agent',
                instanceId: otherWorkflowInstance.id,
                position: { x: 30, y: 40 },
                uiConfig: { expanded: true },
            },
            {
                workflowId: workflow.id,
                ownerId: user.id,
                nodeType: 'agent',
                instanceId: deletedInstance.id,
                position: { x: 50, y: 60 },
                uiConfig: { expanded: true },
            },
        ]);

        await AgentInstance.deleteOne({ _id: deletedInstance._id });
    });

    afterEach(async () => {
        if (user?._id) {
            await WorkflowNodeV2.deleteMany({ ownerId: user._id });
            await AgentInstance.deleteMany({ userId: user._id });
            await AgentPrototype.deleteMany({ userId: user._id });
            await Workflow.deleteMany({ userId: user._id });
            await User.deleteMany({ _id: user._id });
        }
    });

    it('returns only live instances still present in the requested workflow', async () => {
        const response = await request(app)
            .get(`/api/agent-prototypes/${prototype.id}/impact`)
            .query({ workflowId: workflow.id.toString() })
            .set('Authorization', `Bearer ${accessToken}`);

        expect(response.status).toBe(200);
        expect(response.body.instanceCount).toBe(1);
        expect(response.body.nodeCount).toBe(1);
        expect(response.body.instances).toEqual([
            expect.objectContaining({
                id: liveInstance.id,
                name: 'Instance live',
                position: { x: 10, y: 20 },
            }),
        ]);
        expect(response.body.nodeIds).toHaveLength(1);
        expect(response.body.instances.find((instance: any) => instance.id === otherWorkflowInstance.id)).toBeUndefined();
    });
});
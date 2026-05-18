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
import { UserToolRun } from '../models/UserToolRun.model';
import { Workspace } from '../models/Workspace.model';
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
    prototypeId: string;
    sourceInstanceId: string;
    targetInstanceId: string;
    toolRunExecutionId: string;
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
        tools: [new mongoose.Types.ObjectId()],
        toolSelections: [{ toolId: 'tool.snapshot', versionRef: { versionTag: 'v1', versionNumber: 1, workspaceId: 'ws-1' } }],
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

    const toolRunExecutionId = `tool-run-${new mongoose.Types.ObjectId().toString()}`;
    await UserToolRun.create({
        executionId: toolRunExecutionId,
        ownerUserId: user._id,
        toolId: prototype._id,
        toolVersionTag: 'v1',
        toolContentHash: 'hash-snapshot-v1',
        workflowId: workflow._id,
        agentPrototypeId: prototype._id,
        agentInstanceId: sourceInstance._id,
        launchContext: 'workflow_run',
        status: 'completed',
        runtime: 'python',
        runner: 'docker_rootless',
        inputs: {
            prompt: 'hydrate snapshot'
        },
        outputs: {
            stdout: 'ok',
            result: { restored: true }
        },
        policySnapshot: {
            networkMode: 'restricted',
            timeoutSeconds: 30,
            maxMemoryMb: 256,
            secretAliases: []
        },
        timing: {
            queuedAt: new Date(),
            startedAt: new Date(),
            finishedAt: new Date(),
            durationMs: 42
        }
    });

    await AgentJournal.create([
        {
            workflowId: workflow.id,
            agentInstanceId: sourceInstance.id,
            type: 'tool_invocation',
            severity: 'info',
            timestamp: new Date('2026-04-30T09:00:00.000Z'),
            payload: {
                messageId: 'toolinv:call-snapshot-1:started',
                toolCallId: 'call-snapshot-1',
                toolId: prototype.id,
                functionId: prototype.id,
                toolName: 'tool.snapshot',
                phase: 'started'
            }
        },
        {
            workflowId: workflow.id,
            agentInstanceId: sourceInstance.id,
            type: 'tool_invocation',
            severity: 'info',
            timestamp: new Date('2026-04-30T09:00:01.000Z'),
            payload: {
                messageId: 'toolinv:call-snapshot-1:completed',
                toolCallId: 'call-snapshot-1',
                executionId: toolRunExecutionId,
                toolId: prototype.id,
                functionId: prototype.id,
                toolName: 'tool.snapshot',
                phase: 'completed'
            }
        }
    ]);

    return {
        userId: user.id,
        accessToken: generateAccessToken({
            sub: user.id,
            email: user.email,
            role: user.role
        }),
        workflowId: workflow.id,
        prototypeId: prototype.id,
        sourceInstanceId: sourceInstance.id,
        targetInstanceId: targetInstance.id,
        toolRunExecutionId
    };
}

async function cleanupSnapshotFixture(fixture: SnapshotFixture) {
    await AgentJournal.deleteMany({ workflowId: fixture.workflowId });
    await WorkflowEdge.deleteMany({ workflowId: fixture.workflowId });
    await AgentInstance.deleteMany({ workflowId: fixture.workflowId });
    await UserToolRun.deleteMany({ workflowId: fixture.workflowId });
    await AgentPrototype.deleteMany({ workflowId: fixture.workflowId });
    await Workspace.deleteMany({ scopeType: 'workflow', scopeId: fixture.workflowId });
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
        expect(response.body.workspaceContext).toEqual(expect.objectContaining({
            scopeType: 'workflow',
            scopeId: fixture.workflowId,
            status: 'active',
            manifests: expect.objectContaining({
                packageJson: expect.any(Boolean),
                packageLockJson: expect.any(Boolean),
                requirementsTxt: expect.any(Boolean),
                pyprojectToml: expect.any(Boolean)
            })
        }));
        expect(response.body.runtimeCompatibility).toEqual(expect.objectContaining({
            checkedAt: expect.any(String),
            mode: expect.any(String),
            securityLevel: expect.any(String),
            executionReady: expect.any(Boolean),
            preferredRunner: expect.any(String),
            summary: expect.any(String)
        }));
        expect(response.body.edges).toContainEqual(expect.objectContaining({
            source: `node-${fixture.sourceInstanceId}`,
            target: `node-${fixture.targetInstanceId}`,
            type: 'smoothstep'
        }));
        expect(response.body.toolRuns).toContainEqual(expect.objectContaining({
            executionId: fixture.toolRunExecutionId,
            toolId: fixture.prototypeId,
            workflowId: fixture.workflowId,
            agentInstanceId: fixture.sourceInstanceId,
            agentPrototypeId: fixture.prototypeId,
            launchContext: 'workflow_run',
            status: 'completed',
            runtime: 'python',
            runner: 'docker_rootless',
            outputs: expect.objectContaining({
                stdout: 'ok',
                result: expect.objectContaining({ restored: true })
            })
        }));

        const restoredInstance = response.body.agentInstances.find((instance: any) => instance.id === fixture.sourceInstanceId);
        expect(restoredInstance).toBeDefined();
        expect(restoredInstance.chatMessages).toHaveLength(2);
        expect(restoredInstance.chatMessages).toEqual(expect.arrayContaining([
            expect.objectContaining({
                text: 'restored message',
                image: 'ZmFrZS1pbWFnZQ==',
                mimeType: 'image/png',
                fileName: 'proof.png'
            }),
            expect.objectContaining({
                sender: 'tool',
                toolCallRecord: expect.objectContaining({
                    id: 'call-snapshot-1',
                    toolId: fixture.prototypeId,
                    functionId: fixture.prototypeId,
                    functionName: 'tool.snapshot',
                    executionId: fixture.toolRunExecutionId,
                    durationMs: 42,
                    persistedRunStatus: 'completed',
                    artifacts: [],
                    arguments: expect.objectContaining({ prompt: 'hydrate snapshot' }),
                    result: expect.objectContaining({ restored: true })
                })
            })
        ]));
        expect(restoredInstance.tools).toEqual([]);
        expect(restoredInstance.configuration_json.tools).toBeUndefined();
        expect(restoredInstance.configuration_json.position).toMatchObject({ x: 120, y: 180 });

        const restoredPrototype = response.body.agentPrototypes.find((prototype: any) => prototype.id === fixture.prototypeId);
        expect(restoredPrototype).toEqual(expect.objectContaining({
            tools: [],
            functionIds: ['tool.snapshot'],
            toolSelections: [expect.objectContaining({ toolId: 'tool.snapshot' })]
        }));
    });

    it('returns the same snapshot contract from POST /api/workflows/:id/select', async () => {
        const response = await request(app)
            .post(`/api/workflows/${fixture.workflowId}/select`)
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.reloadedData.workflow.id).toBe(fixture.workflowId);
        expect(response.body.reloadedData.toolRuns).toContainEqual(expect.objectContaining({
            executionId: fixture.toolRunExecutionId,
            toolId: fixture.prototypeId,
            workflowId: fixture.workflowId,
            agentInstanceId: fixture.sourceInstanceId,
            agentPrototypeId: fixture.prototypeId,
            status: 'completed'
        }));
        expect(response.body.reloadedData.edges).toContainEqual(expect.objectContaining({
            source: `node-${fixture.sourceInstanceId}`,
            target: `node-${fixture.targetInstanceId}`,
            type: 'smoothstep'
        }));

        const restoredInstance = response.body.reloadedData.agentInstances.find((instance: any) => instance.id === fixture.sourceInstanceId);
        expect(restoredInstance.chatMessages).toEqual(expect.arrayContaining([
            expect.objectContaining({ text: 'restored message' }),
            expect.objectContaining({
                sender: 'tool',
                toolCallRecord: expect.objectContaining({
                    executionId: fixture.toolRunExecutionId,
                    functionName: 'tool.snapshot',
                    persistedRunStatus: 'completed'
                })
            })
        ]));
    });
});
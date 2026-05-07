import express from 'express';
import passport from 'passport';
import request from 'supertest';
import mongoose from 'mongoose';
import '../middleware/auth.middleware';
import { User } from '../models/User.model';
import { Workflow } from '../models/Workflow.model';
import { AgentInstance } from '../models/AgentInstance.model';
import { AgentJournal } from '../models/AgentJournal.model';
import { UserToolRun } from '../models/UserToolRun.model';
import agentInstancesRoutes from '../routes/agent-instances.routes';
import { generateAccessToken } from '../utils/jwt';

const app = express();
app.use(express.json());
app.use(passport.initialize());
app.use('/api/agent-instances', agentInstancesRoutes);

describe('Agent instance read projection', () => {
    afterEach(async () => {
        await AgentJournal.deleteMany({});
        await UserToolRun.deleteMany({});
        await AgentInstance.deleteMany({});
        await Workflow.deleteMany({});
        await User.deleteMany({ email: /agent-instance-read-/i });
    });

    it('returns projected chatMessages using the same tool block projection as workspace hydration', async () => {
        const user = await User.create({
            email: `agent-instance-read-${Date.now()}@test.com`,
            password: 'hashedpassword12345',
            username: `agentinstanceread${Date.now()}`
        });
        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });

        const workflow = await Workflow.create({
            userId: user._id,
            name: 'Read Projection Workflow',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 }
        });

        const instance = await AgentInstance.create({
            workflowId: workflow._id,
            userId: user._id,
            executionId: `exec-read-${Date.now()}`,
            status: 'running',
            name: 'Read Projection Agent',
            role: 'assistant',
            systemPrompt: 'system',
            llmProvider: 'mock',
            llmModel: 'mock-model',
            capabilities: [],
            robotId: 'AR_001',
            position: { x: 0, y: 0 },
            isMinimized: false,
            isMaximized: false,
            zIndex: 1,
            content: [],
            metrics: {
                totalTokens: 0,
                totalErrors: 0,
                totalMediaGenerated: 0,
                callCount: 0
            },
            persistenceConfig: {
                saveChat: true,
                saveChatHistory: true,
                saveErrors: true,
                saveTasks: false,
                saveTaskExecution: false,
                saveLinks: false,
                saveMedia: true,
                saveHistorySummary: false,
                mediaStorage: 'db'
            }
        });

        const toolId = new mongoose.Types.ObjectId();
        const executionId = `tool-read-${new mongoose.Types.ObjectId().toString()}`;

        await AgentJournal.create({
            workflowId: workflow._id,
            agentInstanceId: instance._id,
            type: 'chat',
            severity: 'info',
            timestamp: new Date('2026-05-01T09:00:00.000Z'),
            payload: {
                messageId: 'chat-read-1',
                role: 'agent',
                content: 'projection restored',
                toolCalls: [
                    {
                        id: 'call-read-1',
                        name: 'weather_tool',
                        arguments: '{"city":"Paris"}'
                    }
                ]
            }
        });

        await AgentJournal.create([
            {
                workflowId: workflow._id,
                agentInstanceId: instance._id,
                type: 'tool_invocation',
                severity: 'info',
                timestamp: new Date('2026-05-01T09:00:01.000Z'),
                payload: {
                    messageId: 'toolinv:call-read-1:started',
                    toolCallId: 'call-read-1',
                    toolId: toolId.toString(),
                    functionId: toolId.toString(),
                    toolName: 'weather_tool',
                    phase: 'started'
                }
            },
            {
                workflowId: workflow._id,
                agentInstanceId: instance._id,
                type: 'tool_invocation',
                severity: 'info',
                timestamp: new Date('2026-05-01T09:00:02.000Z'),
                payload: {
                    messageId: 'toolinv:call-read-1:completed',
                    toolCallId: 'call-read-1',
                    executionId,
                    toolId: toolId.toString(),
                    functionId: toolId.toString(),
                    toolName: 'weather_tool',
                    phase: 'completed'
                }
            }
        ]);

        await UserToolRun.create({
            executionId,
            ownerUserId: user._id,
            toolId,
            toolVersionTag: 'v1',
            toolContentHash: 'hash-read-v1',
            workflowId: workflow._id,
            agentInstanceId: instance._id,
            launchContext: 'workflow_run',
            status: 'completed',
            runtime: 'python',
            runner: 'docker_rootless',
            inputs: { city: 'Paris' },
            outputs: {
                result: { temperature: 21 },
                artifacts: [{ path: 'output/weather.json', kind: 'json' }]
            },
            policySnapshot: {
                networkMode: 'restricted',
                timeoutSeconds: 30,
                maxMemoryMb: 256,
                secretAliases: []
            },
            timing: {
                queuedAt: new Date('2026-05-01T09:00:01.000Z'),
                startedAt: new Date('2026-05-01T09:00:01.100Z'),
                finishedAt: new Date('2026-05-01T09:00:02.000Z'),
                durationMs: 900
            }
        });

        const response = await request(app)
            .get(`/api/agent-instances/${instance.id}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .expect(200);

        expect(response.body.chatMessages).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: 'chat-read-1',
                sender: 'agent',
                text: 'projection restored',
                toolCalls: [
                    expect.objectContaining({
                        id: 'call-read-1',
                        name: 'weather_tool'
                    })
                ]
            }),
            expect.objectContaining({
                sender: 'tool',
                toolCallRecord: expect.objectContaining({
                    id: 'call-read-1',
                    toolId: toolId.toString(),
                    functionId: toolId.toString(),
                    functionName: 'weather_tool',
                    executionId,
                    durationMs: 900,
                    persistedRunStatus: 'completed',
                    arguments: expect.objectContaining({ city: 'Paris' }),
                    result: expect.objectContaining({ temperature: 21 }),
                    artifacts: [{ path: 'output/weather.json', kind: 'json' }]
                })
            })
        ]));
    });
});
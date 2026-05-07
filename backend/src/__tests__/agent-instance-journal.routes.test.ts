import express from 'express';
import passport from 'passport';
import request from 'supertest';
import '../middleware/auth.middleware';
import { User } from '../models/User.model';
import { Workflow } from '../models/Workflow.model';
import { AgentInstance } from '../models/AgentInstance.model';
import { AgentJournal } from '../models/AgentJournal.model';
import agentInstancesRoutes from '../routes/agent-instances.routes';
import { JournalService } from '../services/journal.service';
import { generateAccessToken } from '../utils/jwt';

const app = express();
app.use(express.json());
app.use(passport.initialize());
app.use('/api/workflows/:workflowId/instances', agentInstancesRoutes);

describe('Agent instance journal route centralization', () => {
    afterEach(async () => {
        jest.restoreAllMocks();
        await AgentJournal.deleteMany({});
        await AgentInstance.deleteMany({});
        await Workflow.deleteMany({});
        await User.deleteMany({ email: /agent-instance-journal-/i });
    });

    it('delegates journal writes to JournalService and preserves deduplication semantics', async () => {
        const user = await User.create({
            email: `agent-instance-journal-${Date.now()}@test.com`,
            password: 'hashedpassword12345',
            username: `agentinstancejournal${Date.now()}`
        });
        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });

        const workflow = await Workflow.create({
            userId: user._id,
            name: 'Journal Route Workflow',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 }
        });

        const instance = await AgentInstance.create({
            workflowId: workflow._id,
            userId: user._id,
            executionId: `exec-route-${Date.now()}`,
            status: 'running',
            name: 'Journal Route Agent',
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

        const persistSpy = jest.spyOn(JournalService.prototype, 'persistJournalEntry');

        const firstResponse = await request(app)
            .post(`/api/workflows/${workflow.id}/instances/${instance.id}/journal`)
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
                type: 'chat',
                payload: {
                    role: 'tool',
                    content: 'hello from route',
                    messageId: 'journal-msg-1'
                }
            })
            .expect(200);

        expect(firstResponse.body).toEqual(expect.objectContaining({ success: true, journalId: expect.any(String) }));
        expect(persistSpy).toHaveBeenCalledWith({
            instanceId: instance.id,
            type: 'chat',
            payload: expect.objectContaining({
                role: 'tool',
                content: 'hello from route',
                messageId: 'journal-msg-1'
            })
        });

        const savedEntry = await AgentJournal.findOne({ agentInstanceId: instance._id }).lean();
        expect(savedEntry?.payload).toEqual(expect.objectContaining({
            role: 'tool',
            content: 'hello from route',
            messageId: 'journal-msg-1'
        }));

        const duplicateResponse = await request(app)
            .post(`/api/workflows/${workflow.id}/instances/${instance.id}/journal`)
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
                type: 'chat',
                payload: {
                    role: 'tool',
                    content: 'hello from route',
                    messageId: 'journal-msg-1'
                }
            })
            .expect(200);

        expect(duplicateResponse.body).toEqual(expect.objectContaining({
            skipped: true,
            reason: 'Duplicate messageId - entry already exists',
            existingJournalId: expect.any(String)
        }));
    });

    it('accepts tool_invocation entries and deduplicates repeated execution phases through JournalService', async () => {
        const user = await User.create({
            email: `agent-instance-journal-tool-${Date.now()}@test.com`,
            password: 'hashedpassword12345',
            username: `agentinstancejournaltool${Date.now()}`
        });
        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });

        const workflow = await Workflow.create({
            userId: user._id,
            name: 'Journal Route Tool Workflow',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 }
        });

        const instance = await AgentInstance.create({
            workflowId: workflow._id,
            userId: user._id,
            executionId: `exec-route-tool-${Date.now()}`,
            status: 'running',
            name: 'Journal Route Tool Agent',
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

        const firstResponse = await request(app)
            .post(`/api/workflows/${workflow.id}/instances/${instance.id}/journal`)
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
                type: 'tool_invocation',
                payload: {
                    messageId: 'route-tool-msg-1',
                    toolCallId: 'route-call-1',
                    executionId: 'route-exec-1',
                    toolId: 'tool.weather',
                    functionId: 'legacy-weather',
                    toolName: 'Weather Tool',
                    phase: 'started'
                }
            })
            .expect(200);

        expect(firstResponse.body).toEqual(expect.objectContaining({ success: true, journalId: expect.any(String) }));

        const duplicateResponse = await request(app)
            .post(`/api/workflows/${workflow.id}/instances/${instance.id}/journal`)
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
                type: 'tool_invocation',
                payload: {
                    messageId: 'route-tool-msg-1',
                    toolCallId: 'route-call-1',
                    executionId: 'route-exec-1',
                    toolId: 'tool.weather',
                    functionId: 'legacy-weather',
                    toolName: 'Weather Tool',
                    phase: 'started'
                }
            })
            .expect(200);

        expect(duplicateResponse.body).toEqual(expect.objectContaining({
            skipped: true,
            reason: 'Duplicate tool invocation - entry already exists',
            existingJournalId: expect.any(String)
        }));

        const completedResponse = await request(app)
            .post(`/api/workflows/${workflow.id}/instances/${instance.id}/journal`)
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
                type: 'tool_invocation',
                payload: {
                    messageId: 'route-tool-msg-2',
                    toolCallId: 'route-call-1',
                    executionId: 'route-exec-1',
                    toolId: 'tool.weather',
                    functionId: 'legacy-weather',
                    toolName: 'Weather Tool',
                    phase: 'completed'
                }
            })
            .expect(200);

        expect(completedResponse.body).toEqual(expect.objectContaining({ success: true, journalId: expect.any(String) }));

        const savedEntries = await AgentJournal.find({ agentInstanceId: instance._id }).sort({ timestamp: 1 }).lean();
        expect(savedEntries).toHaveLength(2);
        expect(savedEntries.map((entry) => entry.type)).toEqual(['tool_invocation', 'tool_invocation']);
        expect(savedEntries[0]?.payload).toEqual(expect.objectContaining({
            toolCallId: 'route-call-1',
            executionId: 'route-exec-1',
            phase: 'started'
        }));
        expect(savedEntries[1]?.payload).toEqual(expect.objectContaining({
            toolCallId: 'route-call-1',
            executionId: 'route-exec-1',
            phase: 'completed'
        }));
    });
});
import mongoose from 'mongoose';
import { User } from '../models/User.model';
import { Workflow } from '../models/Workflow.model';
import { AgentInstance } from '../models/AgentInstance.model';
import { AgentJournal } from '../models/AgentJournal.model';
import { JournalService } from '../services/journal.service';

describe('JournalService payload compatibility', () => {
    const journalService = new JournalService();

    afterEach(async () => {
        await AgentJournal.deleteMany({});
        await AgentInstance.deleteMany({});
        await Workflow.deleteMany({});
        await User.deleteMany({ email: /journal-service-/i });
    });

    it('persists chat payloads in the legacy top-level shape used by hydration', async () => {
        const user = await User.create({
            email: `journal-service-${Date.now()}@test.com`,
            password: 'hashedpassword12345',
            username: `journalservice${Date.now()}`
        });

        const workflow = await Workflow.create({
            userId: user._id,
            name: 'Journal Service Workflow',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 }
        });

        const instance = await AgentInstance.create({
            workflowId: workflow._id,
            userId: user._id,
            executionId: `exec-${Date.now()}`,
            status: 'running',
            name: 'Journal Agent',
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

        const result = await journalService.logChat({
            instanceId: instance.id,
            role: 'tool',
            content: 'hello from tool',
            model: 'mock-model',
            tokensUsed: 42,
            toolCalls: [
                {
                    name: 'hello_test',
                    arguments: '{"user_name":"Syl"}'
                }
            ]
        });

        expect(result.success).toBe(true);
        expect(result.saved).toBe(true);

        const savedEntry = await AgentJournal.findById(result.entryId).lean();
        expect(savedEntry).not.toBeNull();
        expect(savedEntry?.type).toBe('chat');
        expect(savedEntry?.payload).toEqual(expect.objectContaining({
            role: 'tool',
            content: 'hello from tool',
            modelUsed: 'mock-model',
            tokensUsed: 42,
            toolCalls: [
                {
                    id: 'hello_test',
                    name: 'hello_test',
                    arguments: '{"user_name":"Syl"}'
                }
            ]
        }));
        expect((savedEntry?.payload as Record<string, unknown>).data).toBeUndefined();
        expect((savedEntry?.payload as Record<string, unknown>).type).toBeUndefined();
    });

    it('persists tool_invocation payloads in a top-level projection shape and deduplicates repeated phases per execution', async () => {
        const user = await User.create({
            email: `journal-service-tool-${Date.now()}@test.com`,
            password: 'hashedpassword12345',
            username: `journalservicetool${Date.now()}`
        });

        const workflow = await Workflow.create({
            userId: user._id,
            name: 'Journal Service Tool Workflow',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 }
        });

        const instance = await AgentInstance.create({
            workflowId: workflow._id,
            userId: user._id,
            executionId: `exec-tool-${Date.now()}`,
            status: 'running',
            name: 'Journal Tool Agent',
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

        const startedResult = await journalService.persistJournalEntry({
            instanceId: instance.id,
            type: 'tool_invocation' as any,
            payload: {
                messageId: 'tool-msg-1',
                toolCallId: 'call-1',
                executionId: 'exec-tool-run-1',
                toolId: 'tool.weather',
                functionId: 'legacy-weather',
                toolName: 'Weather Tool',
                phase: 'started'
            } as any
        });

        expect(startedResult.success).toBe(true);
        expect(startedResult.saved).toBe(true);

        const duplicateStartedResult = await journalService.persistJournalEntry({
            instanceId: instance.id,
            type: 'tool_invocation' as any,
            payload: {
                messageId: 'tool-msg-1',
                toolCallId: 'call-1',
                executionId: 'exec-tool-run-1',
                toolId: 'tool.weather',
                functionId: 'legacy-weather',
                toolName: 'Weather Tool',
                phase: 'started'
            } as any
        });

        expect(duplicateStartedResult.success).toBe(true);
        expect(duplicateStartedResult.saved).toBe(false);
        expect(duplicateStartedResult.reason).toBe('Duplicate tool invocation - entry already exists');

        const completedResult = await journalService.persistJournalEntry({
            instanceId: instance.id,
            type: 'tool_invocation' as any,
            payload: {
                messageId: 'tool-msg-2',
                toolCallId: 'call-1',
                executionId: 'exec-tool-run-1',
                toolId: 'tool.weather',
                functionId: 'legacy-weather',
                toolName: 'Weather Tool',
                phase: 'completed'
            } as any
        });

        expect(completedResult.success).toBe(true);
        expect(completedResult.saved).toBe(true);

        const savedEntries = await AgentJournal.find({ agentInstanceId: instance._id }).sort({ timestamp: 1 }).lean();
        expect(savedEntries).toHaveLength(2);
        expect(savedEntries[0]?.type).toBe('tool_invocation');
        expect(savedEntries[0]?.payload).toEqual(expect.objectContaining({
            messageId: 'tool-msg-1',
            toolCallId: 'call-1',
            executionId: 'exec-tool-run-1',
            toolId: 'tool.weather',
            functionId: 'legacy-weather',
            toolName: 'Weather Tool',
            phase: 'started'
        }));
        expect(savedEntries[1]?.payload).toEqual(expect.objectContaining({
            executionId: 'exec-tool-run-1',
            phase: 'completed'
        }));
        expect((savedEntries[0]?.payload as Record<string, unknown>).data).toBeUndefined();
        expect((savedEntries[0]?.payload as Record<string, unknown>).type).toBeUndefined();
    });
});
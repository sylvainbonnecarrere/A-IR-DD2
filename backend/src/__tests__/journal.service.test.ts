import fs from 'fs/promises';
import path from 'path';
import mongoose from 'mongoose';
import { User } from '../models/User.model';
import { Workflow } from '../models/Workflow.model';
import { AgentInstance } from '../models/AgentInstance.model';
import { AgentJournal } from '../models/AgentJournal.model';
import { MediaReference } from '../models/MediaReference.model';
import { Workspace } from '../models/Workspace.model';
import { CloudConnectionProfile } from '../models/CloudConnectionProfile.model';
import { JournalService } from '../services/journal.service';
import { S3StorageStrategy } from '../services/s3Storage.service';

describe('JournalService payload compatibility', () => {
    const testWorkspaceStorageRoot = path.join(process.cwd(), 'storage-test-journal-workspaces');
    let journalService: JournalService;

    beforeEach(() => {
        process.env.WORKSPACE_STORAGE_PATH = testWorkspaceStorageRoot;
        journalService = new JournalService();
    });

    afterEach(async () => {
        jest.restoreAllMocks();
        await fs.rm(testWorkspaceStorageRoot, { recursive: true, force: true }).catch(() => undefined);
        await Workspace.deleteMany({});
        await MediaReference.deleteMany({});
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

    it('creates a MediaReference catalog entry for inline database media journal writes', async () => {
        const user = await User.create({
            email: `journal-service-media-db-${Date.now()}@test.com`,
            password: 'hashedpassword12345',
            username: `journalservicemediadb${Date.now()}`
        });

        const workflow = await Workflow.create({
            userId: user._id,
            name: 'Journal Service Media DB Workflow',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 }
        });

        const instance = await AgentInstance.create({
            workflowId: workflow._id,
            userId: user._id,
            executionId: `exec-media-db-${Date.now()}`,
            status: 'running',
            name: 'Media DB Agent',
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

        const result = await journalService.logMedia({
            instanceId: instance.id,
            userId: user.id,
            workflowId: workflow.id,
            file: Buffer.from('inline-media-payload'),
            metadata: {
                originalName: 'artifact.txt',
                mimeType: 'text/plain',
                size: 'inline-media-payload'.length,
                generatedBy: 'Media DB Agent',
                prompt: 'build a text artifact'
            }
        });

        expect(result.success).toBe(true);
        expect(result.saved).toBe(true);

        const journalEntry = await AgentJournal.findById(result.entryId).lean();
        expect(journalEntry).not.toBeNull();

        const mediaReference = await MediaReference.findOne({ journalEntryId: journalEntry?._id }).lean();
        expect(mediaReference).not.toBeNull();
        expect(mediaReference).toEqual(expect.objectContaining({
            storageMode: 'db',
            primaryStorageMode: 'db',
            canonicalLocator: `journal://${result.entryId}`,
            originalName: 'artifact.txt',
            fileName: 'artifact.txt',
            mimeType: 'text/plain',
            generatedBy: 'Media DB Agent',
            prompt: 'build a text artifact',
            createdByAgentName: 'Media DB Agent',
            lastModifiedByAgentName: 'Media DB Agent',
            isOrphan: false,
        }));
    });

    it('creates a workspace-scoped MediaReference catalog entry for local media journal writes', async () => {
        const user = await User.create({
            email: `journal-service-media-local-${Date.now()}@test.com`,
            password: 'hashedpassword12345',
            username: `journalservicemediaLocal${Date.now()}`
        });

        const workflow = await Workflow.create({
            userId: user._id,
            name: 'Journal Service Media Local Workflow',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 }
        });

        const instance = await AgentInstance.create({
            workflowId: workflow._id,
            userId: user._id,
            executionId: `exec-media-local-${Date.now()}`,
            status: 'running',
            name: 'Media Local Agent',
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
                mediaStorage: 'local'
            }
        });

        const result = await journalService.logMedia({
            instanceId: instance.id,
            userId: user.id,
            workflowId: workflow.id,
            file: Buffer.from('workspace-media-payload'),
            metadata: {
                originalName: 'workspace-note.txt',
                mimeType: 'text/plain',
                size: 'workspace-media-payload'.length,
                generatedBy: 'Media Local Agent',
                prompt: 'build a workspace artifact'
            }
        });

        expect(result.success).toBe(true);
        expect(result.saved).toBe(true);

        const mediaReference = await MediaReference.findOne({ originalName: 'workspace-note.txt' }).lean();
        expect(mediaReference).not.toBeNull();
        expect(mediaReference?.storageMode).toBe('local');
        expect(mediaReference?.primaryStorageMode).toBe('workspace');
        expect(mediaReference?.localPath).toContain(`output/media/agents/${instance.id}`);
        expect(mediaReference?.canonicalLocator).toBe(`workspace://${mediaReference?.localPath}`);
        expect(mediaReference?.createdByAgentName).toBe('Media Local Agent');
        expect(mediaReference?.lastModifiedByAgentName).toBe('Media Local Agent');
    });

    it('creates a cloud MediaReference catalog entry for media journal writes using a secured cloud profile', async () => {
        const user = await User.create({
            email: `journal-service-media-cloud-${Date.now()}@test.com`,
            password: 'hashedpassword12345',
            username: `journalservicemediaCloud${Date.now()}`
        });

        const workflow = await Workflow.create({
            userId: user._id,
            name: 'Journal Service Media Cloud Workflow',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 }
        });

        const instance = await AgentInstance.create({
            workflowId: workflow._id,
            userId: user._id,
            executionId: `exec-media-cloud-${Date.now()}`,
            status: 'running',
            name: 'Media Cloud Agent',
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
                mediaStorage: 'cloud',
                cloudConnectionProfileId: 'cloud-profile-1'
            }
        });

        jest.spyOn(CloudConnectionProfile, 'findOne').mockImplementation(() => Promise.resolve({
            enabled: true,
            statusState: 'configured',
            toDecryptedCloudStorageConfig: () => ({
                provider: 's3' as const,
                s3: {
                    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
                    secretAccessKey: 'super-secret-key',
                    bucketName: 'journal-cloud-bucket',
                    region: 'eu-west-3',
                    keyPrefix: 'tenant/'
                }
            })
        }) as any);
        jest.spyOn(S3StorageStrategy.prototype, 'initialize').mockResolvedValue(undefined);
        jest.spyOn(S3StorageStrategy.prototype, 'upload').mockImplementation(async (key) => ({
            success: true,
            key: `tenant/${key}`,
            etag: 'etag-journal-cloud-1'
        }));

        const result = await journalService.logMedia({
            instanceId: instance.id,
            userId: user.id,
            workflowId: workflow.id,
            file: Buffer.from('cloud-media-payload'),
            metadata: {
                originalName: 'cloud-artifact.txt',
                mimeType: 'text/plain',
                size: 'cloud-media-payload'.length,
                generatedBy: 'Media Cloud Agent',
                prompt: 'build a cloud artifact'
            }
        });

        expect(result.success).toBe(true);
        expect(result.saved).toBe(true);

        const journalEntry = await AgentJournal.findById(result.entryId).lean();
        expect(journalEntry).not.toBeNull();
        expect((journalEntry?.payload as Record<string, unknown>).storageMode).toBe('cloud');

        const mediaReference = await MediaReference.findOne({ journalEntryId: journalEntry?._id }).lean();
        expect(mediaReference).not.toBeNull();
        expect(mediaReference).toEqual(expect.objectContaining({
            storageMode: 'cloud',
            primaryStorageMode: 'cloud',
            originalName: 'cloud-artifact.txt',
            mimeType: 'text/plain',
            generatedBy: 'Media Cloud Agent',
            prompt: 'build a cloud artifact',
            createdByAgentName: 'Media Cloud Agent',
            lastModifiedByAgentName: 'Media Cloud Agent',
            cloudConnectionProfileId: 'cloud-profile-1',
            cloudProvider: 's3',
            cloudBucket: 'journal-cloud-bucket',
            cloudKey: expect.stringMatching(/^tenant\/users\/.+\/workflows\/.+\/agents\/.+\/\d{4}-\d{2}\/cloud-artifact-\d+-[a-f0-9]{8}\.txt$/),
            canonicalLocator: expect.stringMatching(/^s3:\/\/journal-cloud-bucket\/tenant\/users\/.+\/workflows\/.+\/agents\/.+\/\d{4}-\d{2}\/cloud-artifact-\d+-[a-f0-9]{8}\.txt$/),
            isOrphan: false,
        }));
    });
});
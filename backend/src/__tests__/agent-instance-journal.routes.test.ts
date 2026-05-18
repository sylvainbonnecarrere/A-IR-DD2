import express from 'express';
import passport from 'passport';
import request from 'supertest';
import '../middleware/auth.middleware';
import { User } from '../models/User.model';
import { Workflow } from '../models/Workflow.model';
import { AgentInstance } from '../models/AgentInstance.model';
import { AgentJournal } from '../models/AgentJournal.model';
import { MediaReference } from '../models/MediaReference.model';
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
        await MediaReference.deleteMany({});
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

    it('catalogs inline chat image attachments as workspace media when saveMedia is enabled', async () => {
        const user = await User.create({
            email: `agent-instance-journal-media-${Date.now()}@test.com`,
            password: 'hashedpassword12345',
            username: `agentinstancejournalmedia${Date.now()}`
        });
        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });

        const workflow = await Workflow.create({
            userId: user._id,
            name: 'Journal Route Media Workflow',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 }
        });

        const instance = await AgentInstance.create({
            workflowId: workflow._id,
            userId: user._id,
            executionId: `exec-route-media-${Date.now()}`,
            status: 'running',
            name: 'Journal Route Media Agent',
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

        const imageBase64 = Buffer.from('fake-png-binary').toString('base64');

        await request(app)
            .post(`/api/workflows/${workflow.id}/instances/${instance.id}/journal`)
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
                type: 'chat',
                payload: {
                    role: 'user',
                    content: 'Analyse cette image',
                    messageId: 'journal-chat-media-1',
                    imageBase64,
                    mimeType: 'image/png',
                    fileName: 'chat-upload.png'
                }
            })
            .expect(200);

        const chatEntry = await AgentJournal.findOne({
            agentInstanceId: instance._id,
            type: 'chat',
            'payload.messageId': 'journal-chat-media-1'
        }).lean();
        expect(chatEntry).not.toBeNull();
        expect(chatEntry?.payload).toEqual(expect.objectContaining({
            imageBase64,
            mimeType: 'image/png',
            fileName: 'chat-upload.png'
        }));

        const mediaJournal = await AgentJournal.findOne({
            agentInstanceId: instance._id,
            type: 'media'
        }).lean();
        expect(mediaJournal).not.toBeNull();
        expect(mediaJournal?.payload).toEqual(expect.objectContaining({
            messageId: 'chat-media::journal-chat-media-1',
            mimeType: 'image/png',
            storageMode: 'local'
        }));

        const mediaReference = await MediaReference.findOne({
            agentInstanceId: instance._id,
            originalName: 'chat-upload.png'
        }).lean();
        expect(mediaReference).not.toBeNull();
        expect(mediaReference).toEqual(expect.objectContaining({
            storageMode: 'local',
            primaryStorageMode: 'workspace',
            originalName: 'chat-upload.png',
            mimeType: 'image/png',
            createdByAgentName: 'Journal Route Media Agent',
            lastModifiedByAgentName: 'Journal Route Media Agent',
            isOrphan: false,
        }));
        expect(mediaReference?.localPath).toContain(`output/media/agents/${instance.id}`);
        expect(mediaReference?.canonicalLocator).toBe(`workspace://${mediaReference?.localPath}`);
    });

    it('catalogs inline chat image attachments even when the chat payload has no fileName', async () => {
        const user = await User.create({
            email: `agent-instance-journal-media-noname-${Date.now()}@test.com`,
            password: 'hashedpassword12345',
            username: `agentinstancejournalmedianoname${Date.now()}`
        });
        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });

        const workflow = await Workflow.create({
            userId: user._id,
            name: 'Journal Route Media No Name Workflow',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 }
        });

        const instance = await AgentInstance.create({
            workflowId: workflow._id,
            userId: user._id,
            executionId: `exec-route-media-noname-${Date.now()}`,
            status: 'running',
            name: 'Journal Route Media No Name Agent',
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

        const imageBase64 = Buffer.from('fake-png-without-name').toString('base64');

        await request(app)
            .post(`/api/workflows/${workflow.id}/instances/${instance.id}/journal`)
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
                type: 'chat',
                payload: {
                    role: 'user',
                    content: 'Analyse cette image sans nom de fichier',
                    messageId: 'journal-chat-media-no-name-1',
                    imageBase64,
                    mimeType: 'image/png'
                }
            })
            .expect(200);

        const mediaJournal = await AgentJournal.findOne({
            agentInstanceId: instance._id,
            type: 'media',
            'payload.messageId': 'chat-media::journal-chat-media-no-name-1'
        }).lean();
        expect(mediaJournal).not.toBeNull();
        expect(mediaJournal?.payload).toEqual(expect.objectContaining({
            mimeType: 'image/png',
            storageMode: 'local'
        }));

        const mediaReference = await MediaReference.findOne({
            agentInstanceId: instance._id,
            mimeType: 'image/png'
        }).sort({ createdAt: -1 }).lean();
        expect(mediaReference).not.toBeNull();
        expect(mediaReference?.originalName).toBe('chat-upload-journal-chat-media-no-name-1.png');
        expect(mediaReference).toEqual(expect.objectContaining({
            storageMode: 'local',
            primaryStorageMode: 'workspace',
            createdByAgentName: 'Journal Route Media No Name Agent',
            isOrphan: false,
        }));
    });

    it('catalogs inline text file attachments when chat payload uses fileContent', async () => {
        const user = await User.create({
            email: `agent-instance-journal-text-file-${Date.now()}@test.com`,
            password: 'hashedpassword12345',
            username: `agentinstancejournaltextfile${Date.now()}`
        });
        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });

        const workflow = await Workflow.create({
            userId: user._id,
            name: 'Journal Route Text File Workflow',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 }
        });

        const instance = await AgentInstance.create({
            workflowId: workflow._id,
            userId: user._id,
            executionId: `exec-route-text-file-${Date.now()}`,
            status: 'running',
            name: 'Journal Route Text File Agent',
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

        await request(app)
            .post(`/api/workflows/${workflow.id}/instances/${instance.id}/journal`)
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
                type: 'chat',
                payload: {
                    role: 'user',
                    content: 'Lis ce fichier texte',
                    messageId: 'journal-chat-text-file-1',
                    fileContent: 'Bonjour depuis le fichier texte',
                    mimeType: 'text/plain',
                    fileName: 'notes.txt'
                }
            })
            .expect(200);

        const mediaJournal = await AgentJournal.findOne({
            agentInstanceId: instance._id,
            type: 'media',
            'payload.messageId': 'chat-media::journal-chat-text-file-1'
        }).lean();
        expect(mediaJournal).not.toBeNull();
        expect(mediaJournal?.payload).toEqual(expect.objectContaining({
            mimeType: 'text/plain',
            storageMode: 'local'
        }));

        const mediaReference = await MediaReference.findOne({
            agentInstanceId: instance._id,
            originalName: 'notes.txt'
        }).lean();
        expect(mediaReference).not.toBeNull();
        expect(mediaReference).toEqual(expect.objectContaining({
            primaryStorageMode: 'workspace',
            mimeType: 'text/plain',
            isOrphan: false,
        }));
    });

    it('imports a pending text file draft as workspace media without forcing a chat entry', async () => {
        const user = await User.create({
            email: `agent-instance-journal-draft-import-${Date.now()}@test.com`,
            password: 'hashedpassword12345',
            username: `agentinstancejournaldraftimport${Date.now()}`
        });
        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });

        const workflow = await Workflow.create({
            userId: user._id,
            name: 'Journal Route Draft Import Workflow',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 }
        });

        const instance = await AgentInstance.create({
            workflowId: workflow._id,
            userId: user._id,
            executionId: `exec-route-draft-import-${Date.now()}`,
            status: 'running',
            name: 'Journal Route Draft Import Agent',
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

        const draftPayload = {
            attachmentId: 'draft-file-1',
            fileName: 'draft-notes.txt',
            mimeType: 'text/plain',
            contentBase64: Buffer.from('Contenu en attente de sauvegarde', 'utf8').toString('base64'),
            origin: 'llm_file_upload'
        };

        await request(app)
            .post(`/api/workflows/${workflow.id}/instances/${instance.id}/imported-media`)
            .set('Authorization', `Bearer ${accessToken}`)
            .send(draftPayload)
            .expect(200)
            .expect(({ body }) => {
                expect(body).toEqual(expect.objectContaining({
                    success: true,
                    journalId: expect.any(String)
                }));
            });

        const mediaJournal = await AgentJournal.findOne({
            agentInstanceId: instance._id,
            type: 'media',
            'payload.messageId': 'draft-import::llm_file_upload::draft-file-1'
        }).lean();
        expect(mediaJournal).not.toBeNull();
        expect(mediaJournal?.payload).toEqual(expect.objectContaining({
            mimeType: 'text/plain',
            storageMode: 'local',
            fileName: expect.stringMatching(/draft-notes/i),
            messageId: 'draft-import::llm_file_upload::draft-file-1'
        }));

        const chatEntry = await AgentJournal.findOne({
            agentInstanceId: instance._id,
            type: 'chat'
        }).lean();
        expect(chatEntry).toBeNull();

        const mediaReference = await MediaReference.findOne({
            agentInstanceId: instance._id,
            originalName: 'draft-notes.txt'
        }).lean();
        expect(mediaReference).not.toBeNull();
        expect(mediaReference).toEqual(expect.objectContaining({
            primaryStorageMode: 'workspace',
            mimeType: 'text/plain',
            createdByAgentName: 'Journal Route Draft Import Agent',
            isOrphan: false,
        }));

        await request(app)
            .post(`/api/workflows/${workflow.id}/instances/${instance.id}/imported-media`)
            .set('Authorization', `Bearer ${accessToken}`)
            .send(draftPayload)
            .expect(200)
            .expect(({ body }) => {
                expect(body).toEqual(expect.objectContaining({
                    skipped: true,
                    reason: 'Duplicate messageId - entry already exists',
                    existingJournalId: expect.any(String)
                }));
            });

        expect(await AgentJournal.countDocuments({
            agentInstanceId: instance._id,
            type: 'media',
            'payload.messageId': 'draft-import::llm_file_upload::draft-file-1'
        })).toBe(1);
    });

    it('backfills workspace media for a duplicate chat save when the legacy chat entry already exists without catalog media', async () => {
        const user = await User.create({
            email: `agent-instance-journal-legacy-media-${Date.now()}@test.com`,
            password: 'hashedpassword12345',
            username: `agentinstancejournallegacymedia${Date.now()}`
        });
        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });

        const workflow = await Workflow.create({
            userId: user._id,
            name: 'Journal Route Legacy Media Workflow',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 }
        });

        const instance = await AgentInstance.create({
            workflowId: workflow._id,
            userId: user._id,
            executionId: `exec-route-legacy-media-${Date.now()}`,
            status: 'running',
            name: 'Journal Route Legacy Media Agent',
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

        const imageBase64 = Buffer.from('legacy-inline-png').toString('base64');

        await AgentJournal.create({
            agentInstanceId: instance._id,
            workflowId: workflow._id,
            type: 'chat',
            severity: 'info',
            payload: {
                role: 'user',
                content: 'Image legacy déjà sauvegardée',
                messageId: 'legacy-chat-inline-1',
                imageBase64,
                mimeType: 'image/png',
                fileName: 'legacy-chat-upload.png'
            },
            timestamp: new Date(),
        });

        const response = await request(app)
            .post(`/api/workflows/${workflow.id}/instances/${instance.id}/journal`)
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
                type: 'chat',
                payload: {
                    role: 'user',
                    content: 'Image legacy déjà sauvegardée',
                    messageId: 'legacy-chat-inline-1',
                    imageBase64,
                    mimeType: 'image/png',
                    fileName: 'legacy-chat-upload.png'
                }
            })
            .expect(200);

        expect(response.body).toEqual(expect.objectContaining({
            skipped: true,
            reason: 'Duplicate messageId - entry already exists',
            existingJournalId: expect.any(String)
        }));

        const mediaJournal = await AgentJournal.findOne({
            agentInstanceId: instance._id,
            type: 'media',
            'payload.messageId': 'chat-media::legacy-chat-inline-1'
        }).lean();
        expect(mediaJournal).not.toBeNull();

        const mediaReference = await MediaReference.findOne({
            agentInstanceId: instance._id,
            originalName: 'legacy-chat-upload.png'
        }).lean();
        expect(mediaReference).not.toBeNull();
        expect(mediaReference).toEqual(expect.objectContaining({
            primaryStorageMode: 'workspace',
            mimeType: 'image/png',
            isOrphan: false,
        }));
    });
});
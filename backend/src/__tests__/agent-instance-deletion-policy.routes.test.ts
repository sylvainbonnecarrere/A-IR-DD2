import fs from 'fs/promises';
import path from 'path';
import express from 'express';
import passport from 'passport';
import request from 'supertest';
import '../middleware/auth.middleware';
import { AgentInstance } from '../models/AgentInstance.model';
import { AgentJournal } from '../models/AgentJournal.model';
import { MediaReference } from '../models/MediaReference.model';
import { User } from '../models/User.model';
import { Workflow } from '../models/Workflow.model';
import agentInstancesRoutes from '../routes/agent-instances.routes';
import { generateAccessToken } from '../utils/jwt';

const app = express();
app.use(express.json());
app.use(passport.initialize());
app.use('/api/workflows/:workflowId/instances', agentInstancesRoutes);

describe('agent instance deletion media policy', () => {
    const testWorkspaceStorageRoot = path.join(process.cwd(), 'storage-test-instance-delete-policy');

    beforeEach(() => {
        process.env.WORKSPACE_STORAGE_PATH = testWorkspaceStorageRoot;
    });

    afterEach(async () => {
        await fs.rm(testWorkspaceStorageRoot, { recursive: true, force: true }).catch(() => undefined);
        await MediaReference.deleteMany({});
        await AgentJournal.deleteMany({});
        await AgentInstance.deleteMany({});
        await Workflow.deleteMany({});
        await User.deleteMany({ email: /agent-instance-delete-policy-/i });
    });

    it('preserves media as orphans while deleting non-media journals and the instance', async () => {
        const user = await User.create({
            email: `agent-instance-delete-policy-${Date.now()}@test.com`,
            password: 'hashedpassword12345',
            username: `agentinstancedeletepolicy${Date.now()}`,
        });
        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });

        const workflow = await Workflow.create({
            userId: user._id,
            name: 'Delete Policy Workflow',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 },
        });

        const instance = await AgentInstance.create({
            workflowId: workflow._id,
            userId: user._id,
            executionId: `delete-policy-${Date.now()}`,
            status: 'running',
            name: 'Deletion Policy Agent',
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
                callCount: 0,
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
                mediaStorage: 'db',
            },
        });

        const mediaJournal = await AgentJournal.create({
            agentInstanceId: instance._id,
            workflowId: workflow._id,
            type: 'media',
            severity: 'info',
            payload: {
                mimeType: 'text/plain',
                fileName: 'orphanable.txt',
                size: 18,
                storageMode: 'database',
                data: Buffer.from('keep me as orphan', 'utf-8'),
            },
            timestamp: new Date(),
        });

        await AgentJournal.create({
            agentInstanceId: instance._id,
            workflowId: workflow._id,
            type: 'chat',
            severity: 'info',
            payload: {
                role: 'agent',
                content: 'remove this chat history',
            },
            timestamp: new Date(),
        });

        const mediaReference = await MediaReference.create({
            userId: user._id,
            workflowId: workflow._id,
            agentInstanceId: instance._id,
            storageMode: 'db',
            primaryStorageMode: 'db',
            canonicalLocator: `journal://${mediaJournal.id}`,
            journalEntryId: mediaJournal._id,
            fileName: 'orphanable.txt',
            originalName: 'orphanable.txt',
            mimeType: 'text/plain',
            size: 18,
            createdByAgentInstanceId: instance._id,
            createdByAgentName: 'Deletion Policy Agent',
            lastModifiedByAgentInstanceId: instance._id,
            lastModifiedByAgentName: 'Deletion Policy Agent',
            isOrphan: false,
        });

        const response = await request(app)
            .delete(`/api/workflows/${workflow.id}/instances/${instance.id}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .set('X-Robot-Id', 'AR_001')
            .query({ mediaPolicy: 'orphan_media' })
            .expect(200);

        expect(response.body).toEqual(expect.objectContaining({
            mediaPolicy: 'orphan_media',
        }));
        expect(response.body.message).toContain('orphelins');
        expect(await AgentInstance.findById(instance.id)).toBeNull();
        expect(await AgentJournal.findById(mediaJournal.id)).not.toBeNull();
        expect(await AgentJournal.findOne({ agentInstanceId: instance._id, type: 'chat' })).toBeNull();

        const orphanedMediaReference = await MediaReference.findById(mediaReference.id).lean();
        expect(orphanedMediaReference).toEqual(expect.objectContaining({
            isOrphan: true,
            orphanReason: 'agent_deleted',
        }));
    });

    it('deletes linked workspace media when delete_media is requested', async () => {
        const user = await User.create({
            email: `agent-instance-delete-policy-local-${Date.now()}@test.com`,
            password: 'hashedpassword12345',
            username: `agentinstancedeletepolicylocal${Date.now()}`,
        });
        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });

        const workflow = await Workflow.create({
            userId: user._id,
            name: 'Delete Policy Local Workflow',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 },
        });

        const instance = await AgentInstance.create({
            workflowId: workflow._id,
            userId: user._id,
            executionId: `delete-policy-local-${Date.now()}`,
            status: 'running',
            name: 'Deletion Policy Local Agent',
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
                callCount: 0,
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
                mediaStorage: 'local',
                allowWorkspaceWrite: true,
            },
        });

        const relativePath = path.posix.join('output', 'media', 'agents', instance.id, '2026-05', 'artifact.txt');
        const absolutePath = path.join(
            testWorkspaceStorageRoot,
            'users',
            user.id,
            'workflows',
            workflow.id,
            'output',
            'media',
            'agents',
            instance.id,
            '2026-05',
            'artifact.txt',
        );
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, 'delete me', 'utf-8');

        await MediaReference.create({
            userId: user._id,
            workflowId: workflow._id,
            agentInstanceId: instance._id,
            storageMode: 'local',
            primaryStorageMode: 'workspace',
            canonicalLocator: `workspace://${relativePath}`,
            localPath: relativePath,
            fileName: 'artifact.txt',
            originalName: 'artifact.txt',
            mimeType: 'text/plain',
            size: 9,
            createdByAgentInstanceId: instance._id,
            createdByAgentName: 'Deletion Policy Local Agent',
            lastModifiedByAgentInstanceId: instance._id,
            lastModifiedByAgentName: 'Deletion Policy Local Agent',
            isOrphan: false,
        });

        await AgentJournal.create({
            agentInstanceId: instance._id,
            workflowId: workflow._id,
            type: 'chat',
            severity: 'info',
            payload: {
                role: 'agent',
                content: 'delete all related data',
            },
            timestamp: new Date(),
        });

        const response = await request(app)
            .delete(`/api/workflows/${workflow.id}/instances/${instance.id}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .set('X-Robot-Id', 'AR_001')
            .query({ mediaPolicy: 'delete_media' })
            .expect(200);

        expect(response.body).toEqual(expect.objectContaining({
            mediaPolicy: 'delete_media',
        }));
        expect(await AgentInstance.findById(instance.id)).toBeNull();
        expect(await MediaReference.findOne({ agentInstanceId: instance._id })).toBeNull();
        expect(await AgentJournal.findOne({ agentInstanceId: instance._id })).toBeNull();
        await expect(fs.access(absolutePath)).rejects.toThrow();
    });
});
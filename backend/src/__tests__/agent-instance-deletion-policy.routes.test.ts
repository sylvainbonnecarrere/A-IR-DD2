import fs from 'fs/promises';
import path from 'path';
import express from 'express';
import passport from 'passport';
import request from 'supertest';
import '../middleware/auth.middleware';
import { AgentInstance } from '../models/AgentInstance.model';
import { AgentJournal } from '../models/AgentJournal.model';
import { CloudConnectionProfile } from '../models/CloudConnectionProfile.model';
import { MediaReference } from '../models/MediaReference.model';
import { User } from '../models/User.model';
import { Workflow } from '../models/Workflow.model';
import agentInstancesRoutes from '../routes/agent-instances.routes';
import { S3StorageStrategy } from '../services/s3Storage.service';
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
        jest.restoreAllMocks();
        await fs.rm(testWorkspaceStorageRoot, { recursive: true, force: true }).catch(() => undefined);
        await CloudConnectionProfile.deleteMany({});
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
        expect(response.body.audit).toEqual(expect.objectContaining({
            severity: 'info',
            anomalyCount: 0,
            origin: 'agent_instance_delete_route',
        }));
        expect(response.body.message).toContain('orphelins');
        expect(await AgentInstance.findById(instance.id)).toBeNull();
        expect(await AgentJournal.findById(mediaJournal.id)).not.toBeNull();
        expect(await AgentJournal.findOne({ agentInstanceId: instance._id, type: 'chat' })).toBeNull();

        const auditJournal = await AgentJournal.findOne({
            agentInstanceId: instance._id,
            type: 'system',
            'payload.event': 'media_deletion_policy_applied',
        }).lean();
        expect(auditJournal).toEqual(expect.objectContaining({
            severity: 'info',
            payload: expect.objectContaining({
                event: 'media_deletion_policy_applied',
                triggeredBy: user.id,
                details: expect.objectContaining({
                    mediaPolicy: 'orphan_media',
                    origin: 'agent_instance_delete_route',
                }),
            }),
        }));

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
        expect(response.body.audit).toEqual(expect.objectContaining({
            severity: 'info',
            anomalyCount: 0,
            origin: 'agent_instance_delete_route',
        }));
        expect(await AgentInstance.findById(instance.id)).toBeNull();
        expect(await MediaReference.findOne({ agentInstanceId: instance._id })).toBeNull();

        const remainingJournals = await AgentJournal.find({ agentInstanceId: instance._id }).lean();
        expect(remainingJournals).toHaveLength(1);
        expect(remainingJournals[0]).toEqual(expect.objectContaining({
            type: 'system',
            severity: 'info',
            payload: expect.objectContaining({
                event: 'media_deletion_policy_applied',
            }),
        }));
        await expect(fs.access(absolutePath)).rejects.toThrow();
    });

    it('physically deletes cloud media when delete_media resolves the profile from the live instance config', async () => {
        const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
        const user = await User.create({
            email: `agent-instance-delete-policy-cloud-${suffix}@test.com`,
            password: 'hashedpassword12345',
            username: `agentinstancedeletepolicycloud${suffix}`,
        });
        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });

        const workflow = await Workflow.create({
            userId: user._id,
            name: 'Delete Policy Cloud Workflow',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 },
        });

        const profile = new CloudConnectionProfile({
            userId: user._id,
            displayName: `agent-instance-delete-policy-cloud-profile-${suffix}`,
            provider: 's3',
            enabled: true,
            target: {
                bucketName: 'instance-delete-bucket',
                region: 'eu-west-3',
                keyPrefix: 'tenant/',
            },
            statusState: 'missing_secret',
        });
        profile.setSecretMaterial({
            provider: 's3',
            s3: {
                accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
                secretAccessKey: 'super-secret-key',
                bucketName: 'instance-delete-bucket',
                region: 'eu-west-3',
                keyPrefix: 'tenant/',
            },
        });
        await profile.save();

        const instance = await AgentInstance.create({
            workflowId: workflow._id,
            userId: user._id,
            executionId: `delete-policy-cloud-${suffix}`,
            status: 'running',
            name: 'Deletion Policy Cloud Agent',
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
                mediaStorage: 'cloud',
                cloudConnectionProfileId: profile.id,
            },
        });

        await MediaReference.create({
            userId: user._id,
            workflowId: workflow._id,
            agentInstanceId: instance._id,
            storageMode: 'cloud',
            primaryStorageMode: 'cloud',
            canonicalLocator: 's3://instance-delete-bucket/tenant/instances/cloud-artifact.txt',
            cloudKey: 'tenant/instances/cloud-artifact.txt',
            cloudProvider: 's3',
            cloudBucket: 'instance-delete-bucket',
            fileName: 'cloud-artifact.txt',
            originalName: 'cloud-artifact.txt',
            mimeType: 'text/plain',
            size: 21,
            createdByAgentInstanceId: instance._id,
            createdByAgentName: 'Deletion Policy Cloud Agent',
            lastModifiedByAgentInstanceId: instance._id,
            lastModifiedByAgentName: 'Deletion Policy Cloud Agent',
            isOrphan: false,
        });

        jest.spyOn(S3StorageStrategy.prototype, 'initialize').mockResolvedValue(undefined);
        const deleteSpy = jest.spyOn(S3StorageStrategy.prototype, 'delete').mockResolvedValue(true);

        const response = await request(app)
            .delete(`/api/workflows/${workflow.id}/instances/${instance.id}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .set('X-Robot-Id', 'AR_001')
            .query({ mediaPolicy: 'delete_media' })
            .expect(200);

        expect(response.body.audit).toEqual(expect.objectContaining({
            severity: 'info',
            anomalyCount: 0,
            origin: 'agent_instance_delete_route',
        }));
        expect(deleteSpy).toHaveBeenCalledWith('tenant/instances/cloud-artifact.txt');
        expect(await MediaReference.findOne({ agentInstanceId: instance._id })).toBeNull();
    });

    it('journals explicit anomalies for missing data and unmanaged external media', async () => {
        const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
        const user = await User.create({
            email: `agent-instance-delete-policy-anomalies-${suffix}@test.com`,
            password: 'hashedpassword12345',
            username: `agentinstancedeletepolicyanomalies${suffix}`,
        });
        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });

        const workflow = await Workflow.create({
            userId: user._id,
            name: 'Delete Policy Anomalies Workflow',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 },
        });

        const instance = await AgentInstance.create({
            workflowId: workflow._id,
            userId: user._id,
            executionId: `delete-policy-anomalies-${suffix}`,
            status: 'running',
            name: 'Deletion Policy Audit Agent',
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

        await AgentJournal.create({
            agentInstanceId: instance._id,
            workflowId: workflow._id,
            type: 'media',
            severity: 'info',
            payload: {
                mimeType: 'text/plain',
                fileName: 'uncatalogued-media.txt',
                size: 12,
                storageMode: 'database',
                data: Buffer.from('uncatalogued', 'utf-8'),
            },
            timestamp: new Date(),
        });

        await MediaReference.create([
            {
                userId: user._id,
                workflowId: workflow._id,
                agentInstanceId: instance._id,
                storageMode: 'db',
                primaryStorageMode: 'db',
                canonicalLocator: 'journal://66b444444444444444444444',
                journalEntryId: '66b444444444444444444444',
                fileName: 'missing-inline.txt',
                originalName: 'missing-inline.txt',
                mimeType: 'text/plain',
                size: 14,
                createdByAgentInstanceId: instance._id,
                createdByAgentName: 'Deletion Policy Audit Agent',
                lastModifiedByAgentInstanceId: instance._id,
                lastModifiedByAgentName: 'Deletion Policy Audit Agent',
                isOrphan: false,
            },
            {
                userId: user._id,
                workflowId: workflow._id,
                agentInstanceId: instance._id,
                storageMode: 'local',
                primaryStorageMode: 'workspace',
                canonicalLocator: 'workspace://output/media/agents/missing/artifact.txt',
                localPath: 'output/media/agents/missing/artifact.txt',
                fileName: 'artifact.txt',
                originalName: 'artifact.txt',
                mimeType: 'text/plain',
                size: 8,
                createdByAgentInstanceId: instance._id,
                createdByAgentName: 'Deletion Policy Audit Agent',
                lastModifiedByAgentInstanceId: instance._id,
                lastModifiedByAgentName: 'Deletion Policy Audit Agent',
                isOrphan: false,
            },
            {
                userId: user._id,
                workflowId: workflow._id,
                agentInstanceId: instance._id,
                storageMode: 'cloud',
                primaryStorageMode: 'cloud',
                canonicalLocator: 'gcs://external-bucket/external.txt',
                cloudKey: 'external.txt',
                cloudProvider: 'gcs',
                cloudBucket: 'external-bucket',
                fileName: 'external.txt',
                originalName: 'external.txt',
                mimeType: 'text/plain',
                size: 16,
                createdByAgentInstanceId: instance._id,
                createdByAgentName: 'Deletion Policy Audit Agent',
                lastModifiedByAgentInstanceId: instance._id,
                lastModifiedByAgentName: 'Deletion Policy Audit Agent',
                isOrphan: false,
            },
        ]);

        const response = await request(app)
            .delete(`/api/workflows/${workflow.id}/instances/${instance.id}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .set('X-Robot-Id', 'AR_001')
            .query({ mediaPolicy: 'delete_media' })
            .expect(200);

        expect(response.body.audit).toEqual(expect.objectContaining({
            severity: 'warn',
            origin: 'agent_instance_delete_route',
        }));
        expect(response.body.audit.anomalyCodes).toEqual(expect.arrayContaining([
            'INLINE_MEDIA_JOURNAL_MISSING',
            'LOCAL_MEDIA_FILE_MISSING',
            'CLOUD_MEDIA_NOT_PHYSICALLY_DELETED',
            'UNCATALOGUED_MEDIA_JOURNALS_DELETED',
        ]));

        const auditJournal = await AgentJournal.findOne({
            agentInstanceId: instance._id,
            type: 'system',
            'payload.event': 'media_deletion_policy_applied',
        }).lean();
        expect(auditJournal).toEqual(expect.objectContaining({
            severity: 'warn',
            payload: expect.objectContaining({
                event: 'media_deletion_policy_applied',
                details: expect.objectContaining({
                    origin: 'agent_instance_delete_route',
                    mediaPolicy: 'delete_media',
                    anomalies: expect.arrayContaining([
                        expect.objectContaining({ code: 'INLINE_MEDIA_JOURNAL_MISSING' }),
                        expect.objectContaining({ code: 'LOCAL_MEDIA_FILE_MISSING' }),
                        expect.objectContaining({ code: 'CLOUD_MEDIA_NOT_PHYSICALLY_DELETED' }),
                        expect.objectContaining({ code: 'UNCATALOGUED_MEDIA_JOURNALS_DELETED' }),
                    ]),
                }),
            }),
        }));
    });
});
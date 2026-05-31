import fs from 'fs/promises';
import path from 'path';
import express from 'express';
import passport from 'passport';
import request from 'supertest';
import '../middleware/auth.middleware';
import { AgentInstance, AgentJournal, CloudConnectionProfile, MediaReference, User, Workflow, Workspace } from '../models';
import { UserToolRun } from '../models/UserToolRun.model';
import mediaRoutes from '../routes/media.routes';
import { S3StorageStrategy } from '../services/s3Storage.service';
import { createWorkspaceManager } from '../services/workspace/WorkspaceManager';
import { generateAccessToken } from '../utils/jwt';

const app = express();
app.use(express.json());
app.use(passport.initialize());
app.use('/api/media', mediaRoutes);

describe('media routes workflow explorer and workspace output compatibility', () => {
    const testWorkspaceStorageRoot = path.join(process.cwd(), 'storage-test-media-routes-workspaces');

    beforeEach(() => {
        process.env.WORKSPACE_STORAGE_PATH = testWorkspaceStorageRoot;
    });

    afterEach(async () => {
        jest.restoreAllMocks();
        const users = await User.find({ email: /media-routes-/i }).select('_id').lean();
        const userIds = users.map((user) => user._id);

        if (userIds.length > 0) {
            await AgentInstance.deleteMany({ userId: { $in: userIds } });
            await Workflow.deleteMany({ userId: { $in: userIds } });
            await CloudConnectionProfile.deleteMany({ userId: { $in: userIds } });
        }

        await fs.rm(testWorkspaceStorageRoot, { recursive: true, force: true }).catch(() => undefined);
        await AgentJournal.deleteMany({});
        await MediaReference.deleteMany({});
        await UserToolRun.deleteMany({});
        await Workspace.deleteMany({});
        await User.deleteMany({ email: /media-routes-/i });
    });

    it('streams workspace-scoped local media stored under outputRoot paths', async () => {
        const user = await User.create({
            email: `media-routes-${Date.now()}@test.com`,
            password: 'hashedpassword12345',
            username: `mediaroutes${Date.now()}`,
        });
        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });
        const workflowId = '66a111111111111111111111';
        const agentInstanceId = '66a222222222222222222222';

        const workspace = await createWorkspaceManager().ensureWorkflowWorkspace(user.id, workflowId);
        const relativePath = path.posix.join('output', 'media', 'agents', agentInstanceId, '2026-05', 'artifact.txt');
        const absolutePath = path.join(workspace.runtimeRoots.outputRoot, 'media', 'agents', agentInstanceId, '2026-05', 'artifact.txt');
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, 'workspace artifact payload', 'utf-8');

        const mediaReference = await MediaReference.create({
            userId: user._id,
            workflowId,
            agentInstanceId,
            storageMode: 'local',
            primaryStorageMode: 'workspace',
            canonicalLocator: `workspace://${relativePath}`,
            localPath: relativePath,
            fileName: 'artifact.txt',
            originalName: 'artifact.txt',
            mimeType: 'text/plain',
            size: 26,
            createdByAgentInstanceId: agentInstanceId,
            createdByAgentName: 'Media Agent',
            lastModifiedByAgentInstanceId: agentInstanceId,
            lastModifiedByAgentName: 'Media Agent',
            isOrphan: false,
        });

        const response = await request(app)
            .get(`/api/media/${mediaReference.id}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .expect(200);

        expect(response.text).toBe('workspace artifact payload');
        expect(response.headers['content-type']).toContain('text/plain');
    });

    it('streams inline database media through the linked journal entry', async () => {
        const user = await User.create({
            email: `media-routes-inline-db-${Date.now()}@test.com`,
            password: 'hashedpassword12345',
            username: `mediaroutesdb${Date.now()}`,
        });
        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });
        const workflowId = '66a333333333333333333333';
        const agentInstanceId = '66a444444444444444444444';

        const journalEntry = await AgentJournal.create({
            agentInstanceId,
            workflowId,
            type: 'media',
            severity: 'info',
            payload: {
                mimeType: 'text/plain',
                fileName: 'inline-db.txt',
                size: 22,
                storageMode: 'database',
                data: Buffer.from('inline db media payload', 'utf-8'),
            },
            timestamp: new Date(),
        });

        const mediaReference = await MediaReference.create({
            userId: user._id,
            workflowId,
            agentInstanceId,
            storageMode: 'db',
            primaryStorageMode: 'db',
            canonicalLocator: `journal://${journalEntry.id}`,
            journalEntryId: journalEntry._id,
            fileName: 'inline-db.txt',
            originalName: 'inline-db.txt',
            mimeType: 'text/plain',
            size: 22,
            createdByAgentInstanceId: agentInstanceId,
            createdByAgentName: 'DB Agent',
            lastModifiedByAgentInstanceId: agentInstanceId,
            lastModifiedByAgentName: 'DB Agent',
            isOrphan: false,
        });

        const response = await request(app)
            .get(`/api/media/${mediaReference.id}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .query({ download: 'true' })
            .expect(200);

        expect(response.text).toBe('inline db media payload');
        expect(response.headers['content-type']).toContain('text/plain');
        expect(response.headers['content-disposition']).toContain('attachment');
    });

    it('deletes inline database media by removing both catalog entry and journal payload source', async () => {
        const user = await User.create({
            email: `media-routes-inline-db-delete-${Date.now()}@test.com`,
            password: 'hashedpassword12345',
            username: `mediaroutesdbdelete${Date.now()}`,
        });
        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });
        const workflowId = '66a555555555555555555555';
        const agentInstanceId = '66a666666666666666666666';

        const journalEntry = await AgentJournal.create({
            agentInstanceId,
            workflowId,
            type: 'media',
            severity: 'info',
            payload: {
                mimeType: 'text/plain',
                fileName: 'inline-db-delete.txt',
                size: 16,
                storageMode: 'database',
                data: Buffer.from('delete me inline', 'utf-8'),
            },
            timestamp: new Date(),
        });

        const mediaReference = await MediaReference.create({
            userId: user._id,
            workflowId,
            agentInstanceId,
            storageMode: 'db',
            primaryStorageMode: 'db',
            canonicalLocator: `journal://${journalEntry.id}`,
            journalEntryId: journalEntry._id,
            fileName: 'inline-db-delete.txt',
            originalName: 'inline-db-delete.txt',
            mimeType: 'text/plain',
            size: 16,
            createdByAgentInstanceId: agentInstanceId,
            createdByAgentName: 'DB Agent',
            lastModifiedByAgentInstanceId: agentInstanceId,
            lastModifiedByAgentName: 'DB Agent',
            isOrphan: false,
        });

        const response = await request(app)
            .delete(`/api/media/${mediaReference.id}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .expect(200);

        expect(response.body).toEqual(expect.objectContaining({
            success: true,
            fileDeleted: true,
        }));
        expect(await MediaReference.findById(mediaReference.id)).toBeNull();
        expect(await AgentJournal.findById(journalEntry.id)).toBeNull();
    });

    it('returns a legacy warning when deleting a runtime artifact still referenced by user_tool_runs', async () => {
        const user = await User.create({
            email: `media-routes-runtime-delete-${Date.now()}@test.com`,
            password: 'hashedpassword12345',
            username: `mediaroutesruntimedelete${Date.now()}`,
        });
        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });
        const workflowId = '66a777777777777777777777';
        const agentInstanceId = '66a888888888888888888888';
        const executionId = 'utr-delete-runtime-1';

        const workspace = await createWorkspaceManager().ensureWorkflowWorkspace(user.id, workflowId);
        const relativePath = 'output/reports/runtime-output.json';
        const absolutePath = path.join(workspace.runtimeRoots.outputRoot, 'reports', 'runtime-output.json');
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, '{"ok":true}', 'utf-8');

        const mediaReference = await MediaReference.create({
            userId: user._id,
            workflowId,
            agentInstanceId,
            storageMode: 'local',
            primaryStorageMode: 'workspace',
            provenance: 'runtime_output',
            sourceExecutionId: executionId,
            canonicalLocator: `workspace://${relativePath}`,
            localPath: relativePath,
            fileName: 'runtime-output.json',
            originalName: 'runtime-output.json',
            mimeType: 'application/json',
            size: 11,
            createdByAgentInstanceId: agentInstanceId,
            createdByAgentName: 'Runtime Agent',
            lastModifiedByAgentInstanceId: agentInstanceId,
            lastModifiedByAgentName: 'Runtime Agent',
            isOrphan: false,
        });

        await UserToolRun.create({
            executionId,
            ownerUserId: user._id,
            toolId: new (require('mongoose').Types.ObjectId)(),
            toolVersionTag: 'v1',
            toolContentHash: 'runtime-delete-hash',
            workflowId,
            agentInstanceId,
            launchContext: 'workflow_run',
            status: 'completed',
            runtime: 'python',
            runner: 'docker_sandbox',
            inputs: {},
            outputs: {
                result: { ok: true },
                artifacts: [{ path: relativePath, kind: 'json' }],
            },
            policySnapshot: { networkMode: 'none' },
            timing: { queuedAt: new Date(), startedAt: new Date(), finishedAt: new Date(), durationMs: 12 },
        });

        const response = await request(app)
            .delete(`/api/media/${mediaReference.id}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .expect(200);

        expect(response.body).toEqual(expect.objectContaining({
            success: true,
            fileDeleted: true,
            warnings: [expect.objectContaining({
                code: 'RUNTIME_OUTPUT_RUN_REFERENCES_RETAINED',
                executionId,
            })],
        }));
        expect(await MediaReference.findById(mediaReference.id)).toBeNull();
        expect(await UserToolRun.findOne({ executionId })).not.toBeNull();
    });

    it('redirects cloud media to a signed URL using the catalog-resolved cloud profile', async () => {
        const user = await User.create({
            email: `media-routes-cloud-read-${Date.now()}@test.com`,
            password: 'hashedpassword12345',
            username: `mediaroutescloudread${Date.now()}`,
        });
        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });

        const workflow = await Workflow.create({
            userId: user._id,
            name: 'Media Routes Cloud Read Workflow',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 },
        });

        const instance = await AgentInstance.create({
            workflowId: workflow._id,
            userId: user._id,
            executionId: `media-routes-cloud-read-${Date.now()}`,
            status: 'running',
            name: 'Cloud Read Agent',
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
            },
        });

        const profile = new CloudConnectionProfile({
            userId: user._id,
            displayName: `media-routes-cloud-read-profile-${Date.now()}`,
            provider: 's3',
            enabled: true,
            target: {
                bucketName: 'media-bucket',
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
                bucketName: 'media-bucket',
                region: 'eu-west-3',
                keyPrefix: 'tenant/',
            },
        });
        await profile.save();

        const mediaReference = await MediaReference.create({
            userId: user._id,
            workflowId: workflow._id,
            agentInstanceId: instance._id,
            storageMode: 'cloud',
            primaryStorageMode: 'cloud',
            canonicalLocator: 's3://media-bucket/tenant/workflows/read-artifact.txt',
            cloudKey: 'tenant/workflows/read-artifact.txt',
            cloudProvider: 's3',
            cloudBucket: 'media-bucket',
            cloudConnectionProfileId: profile.id,
            fileName: 'read-artifact.txt',
            originalName: 'read artifact.txt',
            mimeType: 'text/plain',
            size: 24,
            createdByAgentInstanceId: instance._id,
            createdByAgentName: 'Cloud Read Agent',
            lastModifiedByAgentInstanceId: instance._id,
            lastModifiedByAgentName: 'Cloud Read Agent',
            isOrphan: false,
        });

        jest.spyOn(S3StorageStrategy.prototype, 'initialize').mockResolvedValue(undefined);
        const signedUrlSpy = jest.spyOn(S3StorageStrategy.prototype, 'getSignedUrl').mockResolvedValue(
            'https://signed.example.test/media/read-artifact.txt?signature=123',
        );

        const response = await request(app)
            .get(`/api/media/${mediaReference.id}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .query({ download: 'true' })
            .expect(302);

        expect(response.headers.location).toBe('https://signed.example.test/media/read-artifact.txt?signature=123');
        expect(signedUrlSpy).toHaveBeenCalledWith('tenant/workflows/read-artifact.txt', expect.objectContaining({
            action: 'read',
            responseContentDisposition: 'attachment; filename="read%20artifact.txt"',
        }));
    });

    it('physically deletes cloud media through the catalog profile reference before removing the catalog entry', async () => {
        const user = await User.create({
            email: `media-routes-cloud-delete-${Date.now()}@test.com`,
            password: 'hashedpassword12345',
            username: `mediaroutesclouddelete${Date.now()}`,
        });
        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });

        const workflow = await Workflow.create({
            userId: user._id,
            name: 'Media Routes Cloud Delete Workflow',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 },
        });

        const instance = await AgentInstance.create({
            workflowId: workflow._id,
            userId: user._id,
            executionId: `media-routes-cloud-delete-${Date.now()}`,
            status: 'running',
            name: 'Cloud Delete Agent',
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
            },
        });

        const profile = new CloudConnectionProfile({
            userId: user._id,
            displayName: `media-routes-cloud-delete-profile-${Date.now()}`,
            provider: 's3',
            enabled: true,
            target: {
                bucketName: 'delete-bucket',
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
                bucketName: 'delete-bucket',
                region: 'eu-west-3',
                keyPrefix: 'tenant/',
            },
        });
        await profile.save();

        const journalEntry = await AgentJournal.create({
            agentInstanceId: instance._id,
            workflowId: workflow._id,
            type: 'media',
            severity: 'info',
            payload: {
                mimeType: 'text/plain',
                fileName: 'delete-artifact.txt',
                size: 24,
                storageMode: 'cloud',
                url: 'https://signed.example.test/delete-artifact.txt',
                metadata: {
                    cloudKey: 'tenant/workflows/delete-artifact.txt',
                    cloudProvider: 's3',
                    cloudBucket: 'delete-bucket',
                    cloudConnectionProfileId: profile.id,
                },
            },
            timestamp: new Date(),
        });

        const mediaReference = await MediaReference.create({
            userId: user._id,
            workflowId: workflow._id,
            agentInstanceId: instance._id,
            journalEntryId: journalEntry._id,
            storageMode: 'cloud',
            primaryStorageMode: 'cloud',
            canonicalLocator: 's3://delete-bucket/tenant/workflows/delete-artifact.txt',
            cloudConnectionProfileId: profile.id,
            cloudKey: 'tenant/workflows/delete-artifact.txt',
            cloudProvider: 's3',
            cloudBucket: 'delete-bucket',
            fileName: 'delete-artifact.txt',
            originalName: 'delete-artifact.txt',
            mimeType: 'text/plain',
            size: 24,
            createdByAgentInstanceId: instance._id,
            createdByAgentName: 'Cloud Delete Agent',
            lastModifiedByAgentInstanceId: instance._id,
            lastModifiedByAgentName: 'Cloud Delete Agent',
            isOrphan: false,
        });

        jest.spyOn(S3StorageStrategy.prototype, 'initialize').mockResolvedValue(undefined);
        const deleteSpy = jest.spyOn(S3StorageStrategy.prototype, 'delete').mockResolvedValue(true);

        const response = await request(app)
            .delete(`/api/media/${mediaReference.id}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .expect(200);

        expect(response.body).toEqual(expect.objectContaining({
            success: true,
            fileDeleted: true,
        }));
        expect(deleteSpy).toHaveBeenCalledWith('tenant/workflows/delete-artifact.txt');
        expect(await MediaReference.findById(mediaReference.id)).toBeNull();
    });

    it('lists workflow-scoped media explorer items with product storage tabs', async () => {
        const user = await User.create({
            email: `media-routes-explorer-${Date.now()}@test.com`,
            password: 'hashedpassword12345',
            username: `mediaroutesexplorer${Date.now()}`,
        });
        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });
        const workflowId = '66b111111111111111111111';
        const agentInstanceId = '66b222222222222222222222';

        await MediaReference.create([
            {
                userId: user._id,
                workflowId,
                agentInstanceId,
                storageMode: 'db',
                primaryStorageMode: 'db',
                canonicalLocator: 'journal://66b333333333333333333333',
                journalEntryId: '66b333333333333333333333',
                fileName: 'database-note.txt',
                originalName: 'database-note.txt',
                mimeType: 'text/plain',
                size: 10,
                createdByAgentInstanceId: agentInstanceId,
                createdByAgentName: 'DB Agent',
                lastModifiedByAgentInstanceId: agentInstanceId,
                lastModifiedByAgentName: 'DB Agent',
                isOrphan: false,
            },
            {
                userId: user._id,
                workflowId,
                agentInstanceId,
                storageMode: 'local',
                primaryStorageMode: 'workspace',
                canonicalLocator: 'workspace://output/media/agents/66b222222222222222222222/2026-05/workspace-note.txt',
                localPath: 'output/media/agents/66b222222222222222222222/2026-05/workspace-note.txt',
                fileName: 'workspace-note.txt',
                originalName: 'workspace-note.txt',
                mimeType: 'text/plain',
                size: 20,
                createdByAgentInstanceId: agentInstanceId,
                createdByAgentName: 'Workspace Agent',
                lastModifiedByAgentInstanceId: agentInstanceId,
                lastModifiedByAgentName: 'Workspace Agent',
                isOrphan: false,
            },
            {
                userId: user._id,
                workflowId,
                agentInstanceId,
                storageMode: 'cloud',
                primaryStorageMode: 'cloud',
                canonicalLocator: 's3://bucket/cloud-note.txt',
                cloudKey: 'cloud-note.txt',
                cloudProvider: 's3',
                cloudBucket: 'bucket',
                fileName: 'cloud-note.txt',
                originalName: 'cloud-note.txt',
                mimeType: 'text/plain',
                size: 30,
                createdByAgentInstanceId: agentInstanceId,
                createdByAgentName: 'Cloud Agent',
                lastModifiedByAgentInstanceId: agentInstanceId,
                lastModifiedByAgentName: 'Cloud Agent',
                isOrphan: true,
                orphanedAt: new Date('2026-05-15T10:00:00.000Z'),
                orphanReason: 'manual_detach',
            },
        ]);

        const response = await request(app)
            .get(`/api/media/workflows/${workflowId}/explorer`)
            .set('Authorization', `Bearer ${accessToken}`)
            .query({ q: 'note', includeOrphans: 'true', sortBy: 'name', sortOrder: 'asc' })
            .expect(200);

        expect(response.body.meta).toEqual(expect.objectContaining({
            total: 3,
            counts: {
                db: 1,
                workspace: 1,
                cloud: 1,
            },
        }));
        expect(response.body.data).toEqual(expect.arrayContaining([
            expect.objectContaining({
                storageMode: 'db',
                provenance: null,
                sourceExecutionId: null,
                displayName: 'database-note.txt',
                canonicalLocator: 'journal://66b333333333333333333333',
                createdByAgentName: 'DB Agent',
            }),
            expect.objectContaining({
                storageMode: 'workspace',
                provenance: null,
                sourceExecutionId: null,
                displayName: 'workspace-note.txt',
                canonicalLocator: 'workspace://output/media/agents/66b222222222222222222222/2026-05/workspace-note.txt',
                createdByAgentName: 'Workspace Agent',
            }),
            expect.objectContaining({
                storageMode: 'cloud',
                provenance: null,
                sourceExecutionId: null,
                displayName: 'cloud-note.txt',
                isOrphan: true,
                orphanReason: 'manual_detach',
            }),
        ]));
    });

    it('exposes runtime provenance and execution identifiers in the workflow explorer', async () => {
        const user = await User.create({
            email: `media-routes-runtime-explorer-${Date.now()}@test.com`,
            password: 'hashedpassword12345',
            username: `mediaroutesruntime${Date.now()}`,
        });
        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });
        const workflowId = '66b777777777777777777777';
        const agentInstanceId = '66b888888888888888888888';
        const executionId = 'utr-explorer-runtime-1';

        await MediaReference.create({
            userId: user._id,
            workflowId,
            agentInstanceId,
            storageMode: 'local',
            primaryStorageMode: 'workspace',
            provenance: 'runtime_output',
            sourceExecutionId: executionId,
            canonicalLocator: 'workspace://output/reports/runtime-output.json',
            localPath: 'output/reports/runtime-output.json',
            fileName: 'runtime-output.json',
            originalName: 'runtime-output.json',
            mimeType: 'application/json',
            size: 64,
            createdByAgentInstanceId: agentInstanceId,
            createdByAgentName: 'Runtime Agent',
            lastModifiedByAgentInstanceId: agentInstanceId,
            lastModifiedByAgentName: 'Runtime Agent',
            isOrphan: false,
        });

        const response = await request(app)
            .get(`/api/media/workflows/${workflowId}/explorer`)
            .set('Authorization', `Bearer ${accessToken}`)
            .query({ q: executionId, includeOrphans: 'true', storageMode: 'workspace' })
            .expect(200);

        expect(response.body.meta).toEqual(expect.objectContaining({
            total: 1,
            counts: {
                db: 0,
                workspace: 1,
                cloud: 0,
            },
        }));
        expect(response.body.data).toEqual([
            expect.objectContaining({
                storageMode: 'workspace',
                provenance: 'runtime_output',
                sourceExecutionId: executionId,
                canonicalLocator: 'workspace://output/reports/runtime-output.json',
                displayName: 'runtime-output.json',
                createdByAgentName: 'Runtime Agent',
            }),
        ]);
    });

    it('filters workflow explorer items by mime type and agent name', async () => {
        const user = await User.create({
            email: `media-routes-filtered-explorer-${Date.now()}@test.com`,
            password: 'hashedpassword12345',
            username: `mediaroutesfiltered${Date.now()}`,
        });
        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });
        const workflowId = '66b999999999999999999999';

        await MediaReference.create([
            {
                userId: user._id,
                workflowId,
                agentInstanceId: '66c999999999999999999991',
                storageMode: 'local',
                primaryStorageMode: 'workspace',
                canonicalLocator: 'workspace://output/media/alpha.json',
                localPath: 'output/media/alpha.json',
                fileName: 'alpha.json',
                originalName: 'alpha.json',
                mimeType: 'application/json',
                size: 12,
                createdByAgentName: 'Agent Alpha',
                lastModifiedByAgentName: 'Agent Alpha',
                isOrphan: false,
            },
            {
                userId: user._id,
                workflowId,
                agentInstanceId: '66c999999999999999999992',
                storageMode: 'local',
                primaryStorageMode: 'workspace',
                canonicalLocator: 'workspace://output/media/beta.txt',
                localPath: 'output/media/beta.txt',
                fileName: 'beta.txt',
                originalName: 'beta.txt',
                mimeType: 'text/plain',
                size: 14,
                createdByAgentName: 'Agent Beta',
                lastModifiedByAgentName: 'Agent Beta',
                isOrphan: false,
            },
        ]);

        const response = await request(app)
            .get(`/api/media/workflows/${workflowId}/explorer`)
            .set('Authorization', `Bearer ${accessToken}`)
            .query({ storageMode: 'workspace', mimeType: 'json', agentName: 'alpha' })
            .expect(200);

        expect(response.body.meta).toEqual(expect.objectContaining({
            total: 1,
            counts: {
                db: 0,
                workspace: 1,
                cloud: 0,
            },
        }));
        expect(response.body.data).toEqual([
            expect.objectContaining({
                originalName: 'alpha.json',
                mimeType: 'application/json',
                createdByAgentName: 'Agent Alpha',
            }),
        ]);
    });

    it('keeps explorer GET read-only and repairs legacy media catalog entries through an explicit maintenance route', async () => {
        const user = await User.create({
            email: `media-routes-legacy-explorer-${Date.now()}@test.com`,
            password: 'hashedpassword12345',
            username: `mediarouteslegacy${Date.now()}`,
        });
        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });
        const workflowId = '66ba11111111111111111111';
        const agentInstanceId = '66ba22222222222222222222';

        await Workflow.create({
            _id: workflowId,
            userId: user._id,
            name: 'Legacy Explorer Workflow',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 },
        });

        await AgentInstance.create({
            _id: agentInstanceId,
            workflowId,
            userId: user._id,
            executionId: `legacy-media-${Date.now()}`,
            status: 'running',
            name: 'Legacy Backfill Agent',
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

        const journalEntry = await AgentJournal.create({
            agentInstanceId,
            workflowId,
            type: 'media',
            severity: 'info',
            payload: {
                mimeType: 'text/plain',
                fileName: 'legacy-only.txt',
                size: 19,
                storageMode: 'database',
                data: Buffer.from('legacy only payload', 'utf-8'),
                generationPrompt: 'restore catalog visibility',
                generationModel: 'Legacy Backfill Agent',
            },
            timestamp: new Date(),
        });

        const firstResponse = await request(app)
            .get(`/api/media/workflows/${workflowId}/explorer`)
            .set('Authorization', `Bearer ${accessToken}`)
            .query({ includeOrphans: 'true' })
            .expect(200);

        expect(firstResponse.body.meta).toEqual(expect.objectContaining({
            total: 0,
            counts: {
                db: 0,
                workspace: 0,
                cloud: 0,
            },
        }));
        expect(firstResponse.body.data).toEqual([]);
        expect(await MediaReference.countDocuments({ workflowId })).toBe(0);

        const repairResponse = await request(app)
            .post(`/api/media/workflows/${workflowId}/explorer/repair-legacy-catalog`)
            .set('Authorization', `Bearer ${accessToken}`)
            .send({ storageMode: 'db' })
            .expect(200);

        expect(repairResponse.body).toEqual(expect.objectContaining({
            success: true,
            meta: expect.objectContaining({
                workflowOwned: true,
                scanned: 1,
                missing: 1,
                stale: 0,
                repaired: 1,
                skipped: 0,
            }),
        }));
        expect(await MediaReference.countDocuments({ workflowId })).toBe(1);

        const secondResponse = await request(app)
            .get(`/api/media/workflows/${workflowId}/explorer`)
            .set('Authorization', `Bearer ${accessToken}`)
            .query({ includeOrphans: 'true', agentName: 'backfill', mimeType: 'text/plain' })
            .expect(200);

        expect(secondResponse.body.meta).toEqual(expect.objectContaining({
            total: 1,
            counts: {
                db: 1,
                workspace: 0,
                cloud: 0,
            },
        }));
        expect(secondResponse.body.data).toEqual([
            expect.objectContaining({
                originalName: 'legacy-only.txt',
                createdByAgentName: 'Legacy Backfill Agent',
            }),
        ]);
        expect(await MediaReference.countDocuments({ workflowId })).toBe(1);
    });

    it('repairs stale cloud catalog metadata explicitly before media fetch or delete relies on the catalog', async () => {
        const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
        const user = await User.create({
            email: `media-routes-cloud-repair-${suffix}@test.com`,
            password: 'hashedpassword12345',
            username: `mediaroutescloudrepair${suffix}`,
        });
        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });

        const workflow = await Workflow.create({
            userId: user._id,
            name: 'Media Routes Cloud Repair Workflow',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 },
        });

        const instance = await AgentInstance.create({
            workflowId: workflow._id,
            userId: user._id,
            executionId: `media-routes-cloud-repair-${suffix}`,
            status: 'running',
            name: 'Cloud Repair Agent',
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
                cloudConnectionProfileId: 'runtime-only-profile-should-not-be-used',
            },
        });

        const profile = new CloudConnectionProfile({
            userId: user._id,
            displayName: `media-routes-cloud-repair-profile-${suffix}`,
            provider: 's3',
            enabled: true,
            target: {
                bucketName: 'cloud-repair-bucket',
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
                bucketName: 'cloud-repair-bucket',
                region: 'eu-west-3',
                keyPrefix: 'tenant/',
            },
        });
        await profile.save();

        const journalEntry = await AgentJournal.create({
            agentInstanceId: instance._id,
            workflowId: workflow._id,
            type: 'media',
            severity: 'info',
            payload: {
                mimeType: 'text/plain',
                fileName: 'repair-cloud-artifact.txt',
                size: 24,
                storageMode: 'cloud',
                url: 'https://signed.example.test/repair-cloud-artifact.txt',
                metadata: {
                    cloudKey: 'tenant/workflows/repair-cloud-artifact.txt',
                    cloudProvider: 's3',
                    cloudBucket: 'cloud-repair-bucket',
                    cloudConnectionProfileId: profile.id,
                },
            },
            timestamp: new Date(),
        });

        const staleReference = await MediaReference.create({
            userId: user._id,
            workflowId: workflow._id,
            agentInstanceId: instance._id,
            journalEntryId: journalEntry._id,
            storageMode: 'cloud',
            primaryStorageMode: 'cloud',
            canonicalLocator: 's3://cloud-repair-bucket/tenant/workflows/repair-cloud-artifact.txt',
            cloudKey: 'tenant/workflows/repair-cloud-artifact.txt',
            cloudProvider: 's3',
            cloudBucket: 'cloud-repair-bucket',
            fileName: 'repair-cloud-artifact.txt',
            originalName: 'repair-cloud-artifact.txt',
            mimeType: 'text/plain',
            size: 24,
            createdByAgentInstanceId: instance._id,
            createdByAgentName: 'Cloud Repair Agent',
            lastModifiedByAgentInstanceId: instance._id,
            lastModifiedByAgentName: 'Cloud Repair Agent',
            isOrphan: false,
        });

        const repairResponse = await request(app)
            .post(`/api/media/workflows/${workflow.id}/explorer/repair-legacy-catalog`)
            .set('Authorization', `Bearer ${accessToken}`)
            .send({ storageMode: 'cloud' })
            .expect(200);

        expect(repairResponse.body).toEqual(expect.objectContaining({
            success: true,
            meta: expect.objectContaining({
                workflowOwned: true,
                scanned: 1,
                missing: 0,
                stale: 1,
                repaired: 1,
                skipped: 0,
            }),
        }));

        const repairedReference = await MediaReference.findById(staleReference.id).lean();
        expect(repairedReference).toEqual(expect.objectContaining({
            cloudConnectionProfileId: profile.id,
            cloudKey: 'tenant/workflows/repair-cloud-artifact.txt',
            cloudProvider: 's3',
            cloudBucket: 'cloud-repair-bucket',
        }));
    });

    it('tests cloud configuration through the real S3 strategy path instead of a simulated response', async () => {
        const user = await User.create({
            email: `media-routes-cloud-test-${Date.now()}@test.com`,
            password: 'hashedpassword12345',
            username: `mediaroutescloud${Date.now()}`,
        });
        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });

        jest.spyOn(S3StorageStrategy.prototype, 'initialize').mockResolvedValue(undefined);
        jest.spyOn(S3StorageStrategy.prototype, 'testConnection').mockResolvedValue({
            success: true,
            message: 'Connexion S3 réussie - Bucket: integration-bucket',
            details: {
                bucketExists: true,
                hasWriteAccess: true,
                hasReadAccess: true,
            },
        });

        const response = await request(app)
            .post('/api/media/test-cloud')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
                provider: 's3',
                s3: {
                    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
                    secretAccessKey: 'super-secret-key',
                    region: 'eu-west-3',
                    bucketName: 'integration-bucket',
                },
            })
            .expect(200);

        expect(response.body).toEqual(expect.objectContaining({
            success: true,
            message: 'Connexion S3 réussie - Bucket: integration-bucket',
        }));
        expect(S3StorageStrategy.prototype.initialize).toHaveBeenCalledWith(expect.objectContaining({
            provider: 's3',
        }));
        expect(S3StorageStrategy.prototype.testConnection).toHaveBeenCalled();
    });
});
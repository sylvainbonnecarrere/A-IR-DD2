import fs from 'fs/promises';
import path from 'path';
import express from 'express';
import passport from 'passport';
import request from 'supertest';
import '../middleware/auth.middleware';
import { AgentJournal, MediaReference, User, Workspace } from '../models';
import mediaRoutes from '../routes/media.routes';
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
        await fs.rm(testWorkspaceStorageRoot, { recursive: true, force: true }).catch(() => undefined);
        await AgentJournal.deleteMany({});
        await MediaReference.deleteMany({});
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
                displayName: 'database-note.txt',
                canonicalLocator: 'journal://66b333333333333333333333',
                createdByAgentName: 'DB Agent',
            }),
            expect.objectContaining({
                storageMode: 'workspace',
                displayName: 'workspace-note.txt',
                canonicalLocator: 'workspace://output/media/agents/66b222222222222222222222/2026-05/workspace-note.txt',
                createdByAgentName: 'Workspace Agent',
            }),
            expect.objectContaining({
                storageMode: 'cloud',
                displayName: 'cloud-note.txt',
                isOrphan: true,
                orphanReason: 'manual_detach',
            }),
        ]));
    });
});
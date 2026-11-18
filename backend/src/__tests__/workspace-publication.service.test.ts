import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import mongoose from 'mongoose';
import { MongoWorkspaceLockService } from '../services/runtime/MongoWorkspaceLockService';
import { WorkspacePublicationService } from '../services/workspace/WorkspacePublicationService';
import { WorkspaceManager } from '../services/workspace/WorkspaceManager';
import type { WorkspaceProvisioningResult } from '../services/workspace/types';

describe('WorkspacePublicationService', () => {
    let tempRoot = '';

    afterEach(async () => {
        if (tempRoot) {
            await fs.rm(tempRoot, { recursive: true, force: true });
            tempRoot = '';
        }
    });

    async function createService() {
        tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'airdd2-workspace-publication-'));
        const workspace: WorkspaceProvisioningResult = {
            workspaceId: 'workspace-publication-test',
            wasCreated: false,
            logicalRoot: tempRoot,
            runtimeRoots: {
                sourceRoot: path.join(tempRoot, 'source'),
                manifestsRoot: path.join(tempRoot, 'manifests'),
                buildRoot: path.join(tempRoot, 'build'),
                outputRoot: path.join(tempRoot, 'output'),
            },
            manifests: {
                packageJson: false,
                packageLockJson: false,
                requirementsTxt: false,
                pyprojectToml: false,
            },
            status: 'active',
            lastScanAt: null,
        };
        const manager = new WorkspaceManager();
        jest.spyOn(manager, 'ensureWorkflowWorkspace').mockResolvedValue(workspace);
        const locks = new MongoWorkspaceLockService();
        return { service: new WorkspacePublicationService(manager, locks), locks };
    }

    const makeContext = () => ({
        userId: new mongoose.Types.ObjectId().toHexString(),
        workflowId: new mongoose.Types.ObjectId().toHexString(),
        agentInstanceId: 'agent-1',
    });

    it('holds a shared workspace lock while publishing media', async () => {
        const { service, locks } = await createService();
        const context = makeContext();

        const media = await service.publishPrimaryWorkspaceMedia(
            Buffer.from('image bytes'),
            { originalName: 'image.png', mimeType: 'image/png', size: 11 },
            context,
        );
        if (!media.path) throw new Error('Workspace publication did not return an artifact path');

        const artifactPath = path.join(
            tempRoot,
            'output',
            media.path.replace(/^output\//, '').split('/').join(path.sep),
        );
        await expect(fs.readFile(artifactPath)).resolves.toEqual(Buffer.from('image bytes'));
        const lock = await locks.tryAcquire(context.userId, context.workflowId, 'after-publication');
        expect(lock).not.toBeNull();
        if (lock) await locks.release(lock);
    });

    it('does not write media into a workspace held by another execution', async () => {
        const { service, locks } = await createService();
        const context = makeContext();
        const lock = await locks.tryAcquire(context.userId, context.workflowId, 'active-execution');
        expect(lock).not.toBeNull();

        try {
            await expect(service.publishPrimaryWorkspaceMedia(
                Buffer.from('image bytes'),
                { originalName: 'image.png', mimeType: 'image/png', size: 11 },
                context,
            )).rejects.toThrow('Workspace is locked');
            expect(await fs.readdir(tempRoot)).toEqual([]);
        } finally {
            if (lock) await locks.release(lock);
        }
    });
});

import mongoose from 'mongoose';
import { MediaReference } from '../models/MediaReference.model';

describe('MediaReference additive DDD fields', () => {
    it('persists canonical locator, ownership audit and orphan state additively', async () => {
        const userId = new mongoose.Types.ObjectId();
        const workflowId = new mongoose.Types.ObjectId();
        const agentInstanceId = new mongoose.Types.ObjectId();

        const media = await MediaReference.create({
            userId,
            workflowId,
            agentInstanceId,
            storageMode: 'local',
            primaryStorageMode: 'workspace',
            localPath: 'users/test/workflows/wf-1/output/image.png',
            canonicalLocator: 'workspace://wf-1/output/image.png',
            fileName: 'image.png',
            originalName: 'image-original.png',
            mimeType: 'image/png',
            size: 42,
            createdByAgentInstanceId: agentInstanceId,
            createdByAgentName: 'Archi',
            lastModifiedByAgentInstanceId: agentInstanceId,
            lastModifiedByAgentName: 'Archi',
            isOrphan: true,
            orphanReason: 'agent_deleted',
        });

        expect(media.toObject()).toEqual(expect.objectContaining({
            canonicalLocator: 'workspace://wf-1/output/image.png',
            primaryStorageMode: 'workspace',
            createdByAgentName: 'Archi',
            lastModifiedByAgentName: 'Archi',
            isOrphan: true,
            orphanReason: 'agent_deleted',
        }));
    });
});
import { unlink } from 'fs/promises';
import path from 'path';
import mongoose from 'mongoose';
import { AgentInstance } from '../models/AgentInstance.model';
import { AgentJournal } from '../models/AgentJournal.model';
import { IMediaReference, MediaReference } from '../models/MediaReference.model';
import { getMediaStorageService } from './mediaStorage.service';
import { createWorkspaceManager } from './workspace/WorkspaceManager';

export type AgentDeletionMediaPolicy = 'delete_media' | 'orphan_media';

export interface DeleteAgentInstanceWithPolicyParams {
    userId: string;
    workflowId: string;
    instanceId: string;
    mediaPolicy: AgentDeletionMediaPolicy;
}

export interface DeleteAgentInstanceWithPolicyResult {
    mediaPolicy: AgentDeletionMediaPolicy;
    journalsDeleted: number;
    mediaFilesDeleted: number;
    mediaReferencesDeleted: number;
    mediaReferencesOrphaned: number;
    retainedMediaEntries: number;
}

export class AgentInstanceDeletionPolicyService {
    async deleteInstanceWithPolicy(
        params: DeleteAgentInstanceWithPolicyParams,
    ): Promise<DeleteAgentInstanceWithPolicyResult> {
        const instance = await AgentInstance.findOne({
            _id: params.instanceId,
            userId: params.userId,
            workflowId: params.workflowId,
        });

        if (!instance) {
            throw new Error('INSTANCE_NOT_FOUND');
        }

        const mediaReferences = await MediaReference.find({
            userId: new mongoose.Types.ObjectId(params.userId),
            agentInstanceId: new mongoose.Types.ObjectId(params.instanceId),
        }).lean<IMediaReference[]>();

        let journalsDeleted = 0;
        let mediaFilesDeleted = 0;
        let mediaReferencesDeleted = 0;
        let mediaReferencesOrphaned = 0;
        let retainedMediaEntries = 0;

        if (params.mediaPolicy === 'delete_media') {
            for (const mediaReference of mediaReferences) {
                if (await this.deletePhysicalMedia(mediaReference, params.userId)) {
                    mediaFilesDeleted += 1;
                }
            }

            if (mediaReferences.length > 0) {
                const mediaReferenceDeleteResult = await MediaReference.deleteMany({
                    _id: { $in: mediaReferences.map((reference) => reference._id) },
                });
                mediaReferencesDeleted = mediaReferenceDeleteResult.deletedCount || 0;
            }

            mediaFilesDeleted += await getMediaStorageService().deleteAgentMedia(
                params.userId,
                params.workflowId,
                params.instanceId,
            );
            journalsDeleted = await AgentJournal.deleteByInstance(params.instanceId);
        } else {
            if (mediaReferences.length > 0) {
                const orphanResult = await MediaReference.updateMany(
                    {
                        _id: { $in: mediaReferences.map((reference) => reference._id) },
                    },
                    {
                        $set: {
                            isOrphan: true,
                            orphanReason: 'agent_deleted',
                            orphanedAt: new Date(),
                        },
                    },
                );

                mediaReferencesOrphaned = orphanResult.modifiedCount || 0;
                retainedMediaEntries = mediaReferences.length;
            }

            const journalDeleteResult = await AgentJournal.deleteMany({
                agentInstanceId: new mongoose.Types.ObjectId(params.instanceId),
                type: { $ne: 'media' },
            });
            journalsDeleted = journalDeleteResult.deletedCount || 0;
        }

        await instance.deleteOne();

        return {
            mediaPolicy: params.mediaPolicy,
            journalsDeleted,
            mediaFilesDeleted,
            mediaReferencesDeleted,
            mediaReferencesOrphaned,
            retainedMediaEntries,
        };
    }

    private async deletePhysicalMedia(mediaReference: IMediaReference, userId: string): Promise<boolean> {
        if (mediaReference.storageMode !== 'local') {
            return false;
        }

        return this.deleteLocalMedia(mediaReference, userId);
    }

    private async deleteLocalMedia(mediaReference: IMediaReference, userId: string): Promise<boolean> {
        if (!mediaReference.localPath) {
            return false;
        }

        const normalizedPath = path.normalize(mediaReference.localPath).replace(/\\/g, '/');
        if (normalizedPath.startsWith('users/')) {
            return getMediaStorageService().deleteLocalMedia(normalizedPath);
        }

        if (!normalizedPath.startsWith('output/')) {
            return false;
        }

        const workspace = await createWorkspaceManager().ensureWorkflowWorkspace(
            userId,
            mediaReference.workflowId.toString(),
        );
        const relativeToOutputRoot = normalizedPath.slice('output/'.length);
        const absolutePath = path.join(workspace.runtimeRoots.outputRoot, relativeToOutputRoot);

        try {
            await unlink(absolutePath);
            return true;
        } catch {
            return false;
        }
    }
}
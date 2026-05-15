import { access, unlink } from 'fs/promises';
import path from 'path';
import mongoose from 'mongoose';
import { AgentInstance } from '../models/AgentInstance.model';
import { AgentJournal } from '../models/AgentJournal.model';
import { IMediaReference, MediaReference } from '../models/MediaReference.model';
import { getMediaStorageService } from './mediaStorage.service';
import { createWorkspaceManager } from './workspace/WorkspaceManager';
import type { JournalSeverity } from '../types/persistence';

export type AgentDeletionMediaPolicy = 'delete_media' | 'orphan_media';

export interface DeleteAgentInstanceWithPolicyParams {
    userId: string;
    workflowId: string;
    instanceId: string;
    mediaPolicy: AgentDeletionMediaPolicy;
    deleteInstance?: boolean;
    persistAudit?: boolean;
    auditOrigin?: string;
    triggeredBy?: string;
}

export type MediaDeletionAuditAnomalyCode =
    'LOCAL_MEDIA_FILE_MISSING'
    | 'LOCAL_MEDIA_PATH_UNRESOLVED'
    | 'INLINE_MEDIA_JOURNAL_MISSING'
    | 'CLOUD_MEDIA_NOT_PHYSICALLY_DELETED'
    | 'UNCATALOGUED_MEDIA_JOURNALS_DELETED'
    | 'UNCATALOGUED_MEDIA_JOURNALS_RETAINED'
    | 'LEGACY_WORKSPACE_FILES_DELETED_OUTSIDE_CATALOG';

export interface MediaDeletionAuditAnomaly {
    code: MediaDeletionAuditAnomalyCode;
    message: string;
    count: number;
    samples?: string[];
}

export interface DeleteAgentInstancePolicyAudit {
    instanceId: string;
    workflowId: string;
    instanceName: string;
    mediaPolicy: AgentDeletionMediaPolicy;
    triggeredBy: string;
    origin: string;
    severity: JournalSeverity;
    anomalyCount: number;
    mediaReferenceCount: number;
    mediaJournalCount: number;
    anomalies: MediaDeletionAuditAnomaly[];
    details: Record<string, unknown>;
    journalId?: string;
    persistenceError?: string;
}

export interface DeleteAgentInstanceWithPolicyResult {
    mediaPolicy: AgentDeletionMediaPolicy;
    journalsDeleted: number;
    mediaFilesDeleted: number;
    mediaReferencesDeleted: number;
    mediaReferencesOrphaned: number;
    retainedMediaEntries: number;
    audit: DeleteAgentInstancePolicyAudit;
}

type LocalMediaDeleteOutcome = 'deleted' | 'missing' | 'unresolved';

const DEFAULT_LEGACY_MEDIA_STORAGE_ROOT = process.env.MEDIA_STORAGE_PATH || path.join(process.cwd(), 'storage');

function createAnomalyCollector() {
    const anomalies = new Map<MediaDeletionAuditAnomalyCode, MediaDeletionAuditAnomaly>();

    return {
        add(code: MediaDeletionAuditAnomalyCode, message: string, sample?: string) {
            const existing = anomalies.get(code);

            if (existing) {
                existing.count += 1;
                if (sample) {
                    existing.samples = existing.samples || [];
                    if (!existing.samples.includes(sample) && existing.samples.length < 3) {
                        existing.samples.push(sample);
                    }
                }
                return;
            }

            anomalies.set(code, {
                code,
                message,
                count: 1,
                samples: sample ? [sample] : undefined,
            });
        },
        toArray() {
            return Array.from(anomalies.values());
        },
    };
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
        const mediaJournals = (await AgentJournal.find({
            agentInstanceId: new mongoose.Types.ObjectId(params.instanceId),
            type: 'media',
        })
            .select('_id payload')
            .lean()) as Array<{ _id: mongoose.Types.ObjectId; payload?: { fileName?: string } }>;
        const mediaJournalIds = new Set(mediaJournals.map((journal) => journal._id.toString()));
        const referencedJournalIds = new Set(
            mediaReferences
                .map((reference) => reference.journalEntryId?.toString())
                .filter((value): value is string => Boolean(value)),
        );
        const anomalyCollector = createAnomalyCollector();

        let journalsDeleted = 0;
        let mediaFilesDeleted = 0;
        let mediaReferencesDeleted = 0;
        let mediaReferencesOrphaned = 0;
        let retainedMediaEntries = 0;
        let directlyDeletedReferenceFiles = 0;

        for (const mediaReference of mediaReferences) {
            if (mediaReference.storageMode === 'db' && mediaReference.journalEntryId && !mediaJournalIds.has(mediaReference.journalEntryId.toString())) {
                anomalyCollector.add(
                    'INLINE_MEDIA_JOURNAL_MISSING',
                    'Un journal media inline reference par le catalogue etait deja absent au moment de la suppression.',
                    mediaReference.canonicalLocator,
                );
            }

            if (mediaReference.storageMode === 'cloud' && params.mediaPolicy === 'delete_media') {
                anomalyCollector.add(
                    'CLOUD_MEDIA_NOT_PHYSICALLY_DELETED',
                    'Un media cloud externe a ete dereference mais pas supprime physiquement par l application.',
                    mediaReference.canonicalLocator,
                );
            }
        }

        for (const mediaJournal of mediaJournals) {
            if (!referencedJournalIds.has(mediaJournal._id.toString())) {
                anomalyCollector.add(
                    params.mediaPolicy === 'delete_media'
                        ? 'UNCATALOGUED_MEDIA_JOURNALS_DELETED'
                        : 'UNCATALOGUED_MEDIA_JOURNALS_RETAINED',
                    params.mediaPolicy === 'delete_media'
                        ? 'Des journaux media sans reference catalogue ont ete supprimes avec l instance.'
                        : 'Des journaux media sans reference catalogue sont conserves mais resteront invisibles dans BOS Media.',
                    mediaJournal.payload?.fileName,
                );
            }
        }

        const storageBreakdown = mediaReferences.reduce<Record<'db' | 'local' | 'cloud', number>>((accumulator, mediaReference) => {
            accumulator[mediaReference.storageMode] += 1;
            return accumulator;
        }, { db: 0, local: 0, cloud: 0 });

        if (params.mediaPolicy === 'delete_media') {
            for (const mediaReference of mediaReferences) {
                const deleteOutcome = await this.deletePhysicalMedia(mediaReference, params.userId);

                if (deleteOutcome === 'deleted') {
                    directlyDeletedReferenceFiles += 1;
                    mediaFilesDeleted += 1;
                } else if (deleteOutcome === 'missing') {
                    anomalyCollector.add(
                        'LOCAL_MEDIA_FILE_MISSING',
                        'Le fichier media local ou workspace etait deja absent au moment de la suppression.',
                        mediaReference.canonicalLocator,
                    );
                } else if (deleteOutcome === 'unresolved' && mediaReference.storageMode === 'local') {
                    anomalyCollector.add(
                        'LOCAL_MEDIA_PATH_UNRESOLVED',
                        'Le chemin du media local ou workspace n a pas pu etre resolu pour suppression physique.',
                        mediaReference.canonicalLocator,
                    );
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

            const extraLegacyFilesDeleted = Math.max(0, mediaFilesDeleted - directlyDeletedReferenceFiles);
            if (extraLegacyFilesDeleted > 0) {
                for (let index = 0; index < extraLegacyFilesDeleted; index += 1) {
                    anomalyCollector.add(
                        'LEGACY_WORKSPACE_FILES_DELETED_OUTSIDE_CATALOG',
                        'Des fichiers workspace legacy presents hors catalogue ont ete supprimes lors du nettoyage du dossier agent.',
                    );
                }
            }

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

        if (params.deleteInstance !== false) {
            await instance.deleteOne();
        }

        const anomalies = anomalyCollector.toArray();
        const audit: DeleteAgentInstancePolicyAudit = {
            instanceId: params.instanceId,
            workflowId: params.workflowId,
            instanceName: instance.name,
            mediaPolicy: params.mediaPolicy,
            triggeredBy: params.triggeredBy || params.userId,
            origin: params.auditOrigin || 'agent_instance_delete_route',
            severity: anomalies.length > 0 ? 'warn' : 'info',
            anomalyCount: anomalies.reduce((total, anomaly) => total + anomaly.count, 0),
            mediaReferenceCount: mediaReferences.length,
            mediaJournalCount: mediaJournals.length,
            anomalies,
            details: {
                instanceId: params.instanceId,
                instanceName: instance.name,
                workflowId: params.workflowId,
                mediaPolicy: params.mediaPolicy,
                deleteInstanceRequested: params.deleteInstance !== false,
                origin: params.auditOrigin || 'agent_instance_delete_route',
                storageBreakdown,
                deletedCounts: {
                    journalsDeleted,
                    mediaFilesDeleted,
                    mediaReferencesDeleted,
                    mediaReferencesOrphaned,
                    retainedMediaEntries,
                },
                mediaReferenceCount: mediaReferences.length,
                mediaJournalCount: mediaJournals.length,
                anomalies,
            },
        };

        if (params.persistAudit !== false) {
            const persistedAudit = await this.persistDeletionAudit(audit);
            audit.journalId = persistedAudit.journalId;
            audit.persistenceError = persistedAudit.persistenceError;
        }

        return {
            mediaPolicy: params.mediaPolicy,
            journalsDeleted,
            mediaFilesDeleted,
            mediaReferencesDeleted,
            mediaReferencesOrphaned,
            retainedMediaEntries,
            audit,
        };
    }

    async persistDeletionAudit(audit: DeleteAgentInstancePolicyAudit): Promise<{ journalId?: string; persistenceError?: string }> {
        try {
            const journalEntry = await AgentJournal.create({
                agentInstanceId: new mongoose.Types.ObjectId(audit.instanceId),
                workflowId: new mongoose.Types.ObjectId(audit.workflowId),
                type: 'system',
                severity: audit.severity,
                payload: {
                    event: 'media_deletion_policy_applied',
                    details: audit.details,
                    triggeredBy: audit.triggeredBy,
                },
                timestamp: new Date(),
            });

            return { journalId: journalEntry.id };
        } catch (error) {
            console.error('[AgentInstanceDeletionPolicyService] audit persistence error:', error);
            return {
                persistenceError: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }

    private async deletePhysicalMedia(mediaReference: IMediaReference, userId: string): Promise<LocalMediaDeleteOutcome | null> {
        if (mediaReference.storageMode !== 'local') {
            return null;
        }

        return this.deleteLocalMedia(mediaReference, userId);
    }

    private async deleteLocalMedia(mediaReference: IMediaReference, userId: string): Promise<LocalMediaDeleteOutcome> {
        if (!mediaReference.localPath) {
            return 'unresolved';
        }

        const normalizedPath = path.normalize(mediaReference.localPath).replace(/\\/g, '/');
        let absolutePath: string | null = null;

        if (normalizedPath.startsWith('users/')) {
            absolutePath = path.join(DEFAULT_LEGACY_MEDIA_STORAGE_ROOT, normalizedPath);
        } else if (normalizedPath.startsWith('output/')) {
            const workspace = await createWorkspaceManager().ensureWorkflowWorkspace(
                userId,
                mediaReference.workflowId.toString(),
            );
            const relativeToOutputRoot = normalizedPath.slice('output/'.length);
            absolutePath = path.join(workspace.runtimeRoots.outputRoot, relativeToOutputRoot);
        }

        if (!absolutePath) {
            return 'unresolved';
        }

        try {
            await access(absolutePath);
        } catch {
            return 'missing';
        }

        try {
            await unlink(absolutePath);
            return 'deleted';
        } catch {
            return 'unresolved';
        }
    }
}
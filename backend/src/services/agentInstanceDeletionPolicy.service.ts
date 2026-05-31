import mongoose from 'mongoose';
import { AgentInstance } from '../models/AgentInstance.model';
import { AgentJournal } from '../models/AgentJournal.model';
import { IMediaReference, MediaReference } from '../models/MediaReference.model';
import { UserToolRun } from '../models/UserToolRun.model';
import { getMediaStorageService } from './mediaStorage.service';
import { MediaCatalogService, RepairLegacyJournalMediaCatalogResult } from './mediaCatalog.service';
import {
    AgentInstanceDeletionAuditCounters,
    buildAgentInstanceDeletionAudit,
} from './agentInstanceDeletionAuditBuilder';
import {
    AgentInstanceMediaPhysicalDeletionService,
    MediaDeleteOutcome,
} from './agentInstanceMediaPhysicalDeletion.service';
import type { JournalSeverity } from '../types/persistence';

export type AgentDeletionMediaPolicy = 'delete_media' | 'orphan_media';

export interface DeleteAgentInstanceWithPolicyParams {
    userId: string;
    workflowId: string;
    instanceId: string;
    mediaPolicy: AgentDeletionMediaPolicy;
    session?: mongoose.ClientSession;
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
    | 'RUNTIME_OUTPUT_RUN_REFERENCES_RETAINED'
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

type AnomalyCollector = ReturnType<typeof createAnomalyCollector>;

interface AgentInstanceDeletionTarget {
    _id: mongoose.Types.ObjectId;
    id: string;
    name: string;
    deleteOne: (options?: { session?: mongoose.ClientSession }) => Promise<unknown>;
}

interface AgentInstanceMediaJournalRecord {
    _id: mongoose.Types.ObjectId;
    payload?: { fileName?: string };
}

type DeleteAgentInstancePolicyCounters = AgentInstanceDeletionAuditCounters;

interface DeleteReferencedMediaResult {
    directlyDeletedReferenceFiles: number;
    mediaFilesDeleted: number;
}

interface AgentInstanceDeletionContext {
    instance: AgentInstanceDeletionTarget;
    legacyCatalogRepair: RepairLegacyJournalMediaCatalogResult;
    mediaReferences: IMediaReference[];
    mediaJournals: AgentInstanceMediaJournalRecord[];
    mediaJournalIds: Set<string>;
    referencedJournalIds: Set<string>;
    storageBreakdown: Record<'db' | 'local' | 'cloud', number>;
}

type MediaPolicyExecutionStrategy = (
    context: AgentInstanceDeletionContext,
    params: DeleteAgentInstanceWithPolicyParams,
    anomalyCollector: AnomalyCollector,
) => Promise<DeleteAgentInstancePolicyCounters>;

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
    constructor(
        private readonly mediaCatalogService: MediaCatalogService = new MediaCatalogService(),
        private readonly mediaPhysicalDeletionService: AgentInstanceMediaPhysicalDeletionService = new AgentInstanceMediaPhysicalDeletionService(),
    ) {}

    async deleteInstanceWithPolicy(
        params: DeleteAgentInstanceWithPolicyParams,
    ): Promise<DeleteAgentInstanceWithPolicyResult> {
        const context = await this.loadDeletionContext(params);
        const anomalyCollector = createAnomalyCollector();
        await this.collectPrePolicyAnomalies(context, params, anomalyCollector);

        const policyCounters = await this.getPolicyExecutionStrategy(params.mediaPolicy)(
            context,
            params,
            anomalyCollector,
        );

        if (params.deleteInstance !== false) {
            await context.instance.deleteOne(params.session ? { session: params.session } : undefined);
        }

        const audit = buildAgentInstanceDeletionAudit({
            instanceName: context.instance.name,
            params,
            anomalies: anomalyCollector.toArray(),
            counters: policyCounters,
            mediaReferenceCount: context.mediaReferences.length,
            mediaJournalCount: context.mediaJournals.length,
            storageBreakdown: context.storageBreakdown,
            legacyCatalogRepair: context.legacyCatalogRepair,
        });

        if (params.persistAudit !== false) {
            const persistedAudit = await this.persistDeletionAudit(audit);
            audit.journalId = persistedAudit.journalId;
            audit.persistenceError = persistedAudit.persistenceError;
        }

        return {
            mediaPolicy: params.mediaPolicy,
            ...policyCounters,
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

    private async loadDeletionContext(
        params: DeleteAgentInstanceWithPolicyParams,
    ): Promise<AgentInstanceDeletionContext> {
        const instanceQuery = AgentInstance.findOne({
            _id: params.instanceId,
            userId: params.userId,
            workflowId: params.workflowId,
        });
        if (params.session) {
            instanceQuery.session(params.session);
        }

        const instance = await instanceQuery;

        if (!instance) {
            throw new Error('INSTANCE_NOT_FOUND');
        }

        const instanceId = new mongoose.Types.ObjectId(params.instanceId);
        const userId = new mongoose.Types.ObjectId(params.userId);

        const [legacyCatalogRepair, mediaJournals] = await Promise.all([
            this.mediaCatalogService.repairLegacyJournalMediaCatalog({
                userId: params.userId,
                workflowId: params.workflowId,
                agentInstanceId: params.instanceId,
                session: params.session,
            }),
            AgentJournal.find({
                agentInstanceId: instanceId,
                type: 'media',
            })
                .select('_id payload')
                .session(params.session ?? null)
                .lean<AgentInstanceMediaJournalRecord[]>(),
        ]);

        const mediaReferences = await MediaReference.find({
            userId,
            agentInstanceId: instanceId,
        })
            .session(params.session ?? null)
            .lean<IMediaReference[]>();

        const mediaJournalIds = new Set(mediaJournals.map((journal) => journal._id.toString()));
        const referencedJournalIds = new Set(
            mediaReferences
                .map((reference) => reference.journalEntryId?.toString())
                .filter((value): value is string => Boolean(value)),
        );

        return {
            instance: instance as unknown as AgentInstanceDeletionTarget,
            legacyCatalogRepair,
            mediaReferences,
            mediaJournals,
            mediaJournalIds,
            referencedJournalIds,
            storageBreakdown: this.buildStorageBreakdown(mediaReferences),
        };
    }

    private async collectPrePolicyAnomalies(
        context: AgentInstanceDeletionContext,
        params: DeleteAgentInstanceWithPolicyParams,
        anomalyCollector: AnomalyCollector,
    ): Promise<void> {
        this.collectInlineMediaJournalMissingAnomalies(context, anomalyCollector);
        this.collectUncataloguedMediaJournalAnomalies(context, params.mediaPolicy, anomalyCollector);

        if (params.mediaPolicy === 'delete_media') {
            await this.collectRuntimeArtifactRetentionAnomalies(context, params.userId, anomalyCollector);
        }
    }

    private collectInlineMediaJournalMissingAnomalies(
        context: AgentInstanceDeletionContext,
        anomalyCollector: AnomalyCollector,
    ): void {
        for (const mediaReference of context.mediaReferences) {
            if (mediaReference.storageMode === 'db' && mediaReference.journalEntryId && !context.mediaJournalIds.has(mediaReference.journalEntryId.toString())) {
                anomalyCollector.add(
                    'INLINE_MEDIA_JOURNAL_MISSING',
                    'Un journal media inline reference par le catalogue etait deja absent au moment de la suppression.',
                    mediaReference.canonicalLocator,
                );
            }
        }
    }

    private collectUncataloguedMediaJournalAnomalies(
        context: AgentInstanceDeletionContext,
        mediaPolicy: AgentDeletionMediaPolicy,
        anomalyCollector: AnomalyCollector,
    ): void {
        for (const mediaJournal of context.mediaJournals) {
            if (!context.referencedJournalIds.has(mediaJournal._id.toString())) {
                anomalyCollector.add(
                    mediaPolicy === 'delete_media'
                        ? 'UNCATALOGUED_MEDIA_JOURNALS_DELETED'
                        : 'UNCATALOGUED_MEDIA_JOURNALS_RETAINED',
                    mediaPolicy === 'delete_media'
                        ? 'Des journaux media sans reference catalogue ont ete supprimes avec l instance.'
                        : 'Des journaux media sans reference catalogue sont conserves mais resteront invisibles dans BOS Media.',
                    mediaJournal.payload?.fileName,
                );
            }
        }
    }

    private async collectRuntimeArtifactRetentionAnomalies(
        context: AgentInstanceDeletionContext,
        userId: string,
        anomalyCollector: AnomalyCollector,
    ): Promise<void> {
        const runtimeArtifacts = context.mediaReferences.filter((mediaReference) => (
            mediaReference.provenance === 'runtime_output'
            && typeof mediaReference.sourceExecutionId === 'string'
            && mediaReference.sourceExecutionId.trim().length > 0
        ));

        const executionIds = Array.from(new Set(runtimeArtifacts.map((mediaReference) => mediaReference.sourceExecutionId!.trim())));
        if (executionIds.length === 0) {
            return;
        }

        const retainedRuntimeRuns = await UserToolRun.find({
            ownerUserId: new mongoose.Types.ObjectId(userId),
            executionId: { $in: executionIds },
        })
            .select('executionId')
            .lean<Array<{ executionId: string }>>();
        const retainedExecutionIds = new Set(retainedRuntimeRuns.map((run) => run.executionId));

        for (const runtimeArtifact of runtimeArtifacts) {
            const executionId = runtimeArtifact.sourceExecutionId?.trim();
            if (!executionId || !retainedExecutionIds.has(executionId)) {
                continue;
            }

            anomalyCollector.add(
                'RUNTIME_OUTPUT_RUN_REFERENCES_RETAINED',
                'Un artefact runtime catalogue a ete supprime physiquement alors que l historique user_tool_runs conserve encore une reference legacy vers cette execution.',
                runtimeArtifact.canonicalLocator,
            );
        }
    }

    private getPolicyExecutionStrategy(mediaPolicy: AgentDeletionMediaPolicy): MediaPolicyExecutionStrategy {
        switch (mediaPolicy) {
            case 'delete_media':
                return this.executeDeleteMediaPolicy.bind(this);
            case 'orphan_media':
            default:
                return this.executeOrphanMediaPolicy.bind(this);
        }
    }

    private async executeDeleteMediaPolicy(
        context: AgentInstanceDeletionContext,
        params: DeleteAgentInstanceWithPolicyParams,
        anomalyCollector: AnomalyCollector,
    ): Promise<DeleteAgentInstancePolicyCounters> {
        const referencedMediaDeletion = await this.deleteReferencedMedia(
            context.mediaReferences,
            params.userId,
            anomalyCollector,
        );

        let mediaReferencesDeleted = 0;
        if (context.mediaReferences.length > 0) {
            const mediaReferenceDeleteResult = await MediaReference.deleteMany({
                _id: { $in: context.mediaReferences.map((reference) => reference._id) },
            }, params.session ? { session: params.session } : undefined);
            mediaReferencesDeleted = mediaReferenceDeleteResult.deletedCount || 0;
        }

        let mediaFilesDeleted = referencedMediaDeletion.mediaFilesDeleted;
        mediaFilesDeleted += await getMediaStorageService().deleteAgentMedia(
            params.userId,
            params.workflowId,
            params.instanceId,
        );
        mediaFilesDeleted += await this.mediaPhysicalDeletionService.deleteWorkspaceAgentMedia(
            params.userId,
            params.workflowId,
            params.instanceId,
        );

        this.collectLegacyWorkspaceCleanupAnomalies(
            mediaFilesDeleted,
            referencedMediaDeletion.directlyDeletedReferenceFiles,
            anomalyCollector,
        );

        return {
            journalsDeleted: await AgentJournal.deleteByInstance(params.instanceId, params.session),
            mediaFilesDeleted,
            mediaReferencesDeleted,
            mediaReferencesOrphaned: 0,
            retainedMediaEntries: 0,
        };
    }

    private async executeOrphanMediaPolicy(
        context: AgentInstanceDeletionContext,
        params: DeleteAgentInstanceWithPolicyParams,
    ): Promise<DeleteAgentInstancePolicyCounters> {
        let mediaReferencesOrphaned = 0;
        let retainedMediaEntries = 0;

        if (context.mediaReferences.length > 0) {
            const orphanResult = await MediaReference.updateMany(
                {
                    _id: { $in: context.mediaReferences.map((reference) => reference._id) },
                },
                {
                    $set: {
                        isOrphan: true,
                        orphanReason: 'agent_deleted',
                        orphanedAt: new Date(),
                    },
                },
                params.session ? { session: params.session } : undefined,
            );

            mediaReferencesOrphaned = orphanResult.modifiedCount || 0;
            retainedMediaEntries = context.mediaReferences.length;
        }

        const journalDeleteResult = await AgentJournal.deleteMany({
            agentInstanceId: new mongoose.Types.ObjectId(params.instanceId),
            type: { $ne: 'media' },
        }, params.session ? { session: params.session } : undefined);

        return {
            journalsDeleted: journalDeleteResult.deletedCount || 0,
            mediaFilesDeleted: 0,
            mediaReferencesDeleted: 0,
            mediaReferencesOrphaned,
            retainedMediaEntries,
        };
    }

    private async deleteReferencedMedia(
        mediaReferences: IMediaReference[],
        userId: string,
        anomalyCollector: AnomalyCollector,
    ): Promise<DeleteReferencedMediaResult> {
        let directlyDeletedReferenceFiles = 0;
        let mediaFilesDeleted = 0;

        for (const mediaReference of mediaReferences) {
            const deleteOutcome = await this.mediaPhysicalDeletionService.deleteMediaReference(mediaReference, userId);

            if (deleteOutcome === 'deleted') {
                directlyDeletedReferenceFiles += 1;
                mediaFilesDeleted += 1;
                continue;
            }

            this.collectPhysicalDeleteOutcomeAnomaly(mediaReference, deleteOutcome, anomalyCollector);
        }

        return {
            directlyDeletedReferenceFiles,
            mediaFilesDeleted,
        };
    }

    private collectPhysicalDeleteOutcomeAnomaly(
        mediaReference: IMediaReference,
        deleteOutcome: MediaDeleteOutcome | null,
        anomalyCollector: AnomalyCollector,
    ): void {
        if (deleteOutcome === 'missing') {
            anomalyCollector.add(
                'LOCAL_MEDIA_FILE_MISSING',
                'Le fichier media local ou workspace etait deja absent au moment de la suppression.',
                mediaReference.canonicalLocator,
            );
            return;
        }

        if (deleteOutcome === 'unresolved' && mediaReference.storageMode === 'local') {
            anomalyCollector.add(
                'LOCAL_MEDIA_PATH_UNRESOLVED',
                'Le chemin du media local ou workspace n a pas pu etre resolu pour suppression physique.',
                mediaReference.canonicalLocator,
            );
            return;
        }

        if (deleteOutcome === 'unresolved' && mediaReference.storageMode === 'cloud') {
            anomalyCollector.add(
                'CLOUD_MEDIA_NOT_PHYSICALLY_DELETED',
                'Un media cloud externe a ete dereference mais pas supprime physiquement par l application.',
                mediaReference.canonicalLocator,
            );
        }
    }

    private collectLegacyWorkspaceCleanupAnomalies(
        mediaFilesDeleted: number,
        directlyDeletedReferenceFiles: number,
        anomalyCollector: AnomalyCollector,
    ): void {
        const extraLegacyFilesDeleted = Math.max(0, mediaFilesDeleted - directlyDeletedReferenceFiles);
        if (extraLegacyFilesDeleted === 0) {
            return;
        }

        for (let index = 0; index < extraLegacyFilesDeleted; index += 1) {
            anomalyCollector.add(
                'LEGACY_WORKSPACE_FILES_DELETED_OUTSIDE_CATALOG',
                'Des fichiers workspace legacy presents hors catalogue ont ete supprimes lors du nettoyage du dossier agent.',
            );
        }
    }

    private buildStorageBreakdown(mediaReferences: IMediaReference[]): Record<'db' | 'local' | 'cloud', number> {
        return mediaReferences.reduce<Record<'db' | 'local' | 'cloud', number>>((accumulator, mediaReference) => {
            accumulator[mediaReference.storageMode] += 1;
            return accumulator;
        }, { db: 0, local: 0, cloud: 0 });
    }
}
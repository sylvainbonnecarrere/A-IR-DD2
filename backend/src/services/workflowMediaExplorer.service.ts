import mongoose from 'mongoose';
import { AgentInstance } from '../models/AgentInstance.model';
import { AgentJournal } from '../models/AgentJournal.model';
import { Workflow } from '../models/Workflow.model';
import { MediaProvenance, MediaReference } from '../models/MediaReference.model';
import { MediaCatalogService } from './mediaCatalog.service';
import { MediaJournalPayload } from '../types/persistence';

export type WorkflowMediaExplorerStorageMode = 'db' | 'workspace' | 'cloud';
export type WorkflowMediaExplorerSortBy = 'updatedAt' | 'createdAt' | 'name' | 'size';
export type WorkflowMediaExplorerSortOrder = 'asc' | 'desc';

export interface WorkflowMediaExplorerQuery {
    ownerUserId: string;
    workflowId: string;
    storageMode?: WorkflowMediaExplorerStorageMode;
    search?: string;
    mimeType?: string;
    agentName?: string;
    includeOrphans?: boolean;
    sortBy?: WorkflowMediaExplorerSortBy;
    sortOrder?: WorkflowMediaExplorerSortOrder;
}

export interface WorkflowMediaExplorerItem {
    mediaId: string;
    workflowId: string;
    storageMode: WorkflowMediaExplorerStorageMode;
    provenance: MediaProvenance | null;
    sourceExecutionId: string | null;
    canonicalLocator: string;
    displayName: string;
    originalName: string;
    mimeType: string;
    size: number;
    createdAt: Date;
    updatedAt: Date;
    createdByAgentId: string | null;
    createdByAgentName: string | null;
    lastModifiedByAgentId: string | null;
    lastModifiedByAgentName: string | null;
    isOrphan: boolean;
    orphanReason: string | null;
}

export interface WorkflowMediaExplorerResult {
    items: WorkflowMediaExplorerItem[];
    counts: Record<WorkflowMediaExplorerStorageMode, number>;
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class WorkflowMediaExplorerService {
    constructor(
        private readonly mediaCatalogService: MediaCatalogService = new MediaCatalogService(),
    ) {}

    async listWorkflowMedia(query: WorkflowMediaExplorerQuery): Promise<WorkflowMediaExplorerResult> {
        const ownerUserId = new mongoose.Types.ObjectId(query.ownerUserId);
        const workflowId = new mongoose.Types.ObjectId(query.workflowId);

        await this.backfillLegacyWorkflowMedia(ownerUserId, workflowId, query.storageMode);

        const filters: Record<string, unknown> = {
            userId: ownerUserId,
            workflowId,
        };

        if (!query.includeOrphans) {
            filters.isOrphan = false;
        }

        if (query.storageMode) {
            filters.primaryStorageMode = query.storageMode;
        }

        const trimmedMimeType = query.mimeType?.trim();
        if (trimmedMimeType) {
            filters.mimeType = new RegExp(escapeRegex(trimmedMimeType), 'i');
        }

        const trimmedAgentName = query.agentName?.trim();
        if (trimmedAgentName) {
            const agentRegex = new RegExp(escapeRegex(trimmedAgentName), 'i');
            filters.$and = [
                {
                    $or: [
                        { createdByAgentName: agentRegex },
                        { lastModifiedByAgentName: agentRegex },
                    ],
                },
            ];
        }

        const trimmedSearch = query.search?.trim();
        if (trimmedSearch) {
            const searchRegex = new RegExp(escapeRegex(trimmedSearch), 'i');
            filters.$or = [
                { originalName: searchRegex },
                { fileName: searchRegex },
                { mimeType: searchRegex },
                { canonicalLocator: searchRegex },
                { provenance: searchRegex },
                { sourceExecutionId: searchRegex },
                { createdByAgentName: searchRegex },
                { lastModifiedByAgentName: searchRegex },
            ];
        }

        const sortField = this.resolveSortField(query.sortBy ?? 'updatedAt');
        const sortDirection = query.sortOrder === 'asc' ? 1 : -1;

        const mediaItems = await MediaReference.find(filters)
            .sort({ [sortField]: sortDirection, _id: -1 })
            .lean();

        const items = mediaItems.map((media) => {
            const productStorageMode = media.primaryStorageMode ?? this.derivePrimaryStorageMode(media.storageMode);

            return {
                mediaId: media._id.toString(),
                workflowId: media.workflowId.toString(),
                storageMode: productStorageMode,
                provenance: media.provenance ?? null,
                sourceExecutionId: media.sourceExecutionId ?? null,
                canonicalLocator: media.canonicalLocator,
                displayName: media.fileName,
                originalName: media.originalName,
                mimeType: media.mimeType,
                size: media.size,
                createdAt: media.createdAt,
                updatedAt: media.updatedAt,
                createdByAgentId: media.createdByAgentInstanceId?.toString() ?? null,
                createdByAgentName: media.createdByAgentName ?? null,
                lastModifiedByAgentId: media.lastModifiedByAgentInstanceId?.toString() ?? null,
                lastModifiedByAgentName: media.lastModifiedByAgentName ?? null,
                isOrphan: media.isOrphan,
                orphanReason: media.orphanReason ?? null,
            } satisfies WorkflowMediaExplorerItem;
        });

        const counts = items.reduce<Record<WorkflowMediaExplorerStorageMode, number>>((accumulator, item) => {
            accumulator[item.storageMode] += 1;
            return accumulator;
        }, { db: 0, workspace: 0, cloud: 0 });

        return { items, counts };
    }

    private async backfillLegacyWorkflowMedia(
        ownerUserId: mongoose.Types.ObjectId,
        workflowId: mongoose.Types.ObjectId,
        storageMode?: WorkflowMediaExplorerStorageMode,
    ): Promise<void> {
        const ownedWorkflow = await Workflow.exists({
            _id: workflowId,
            userId: ownerUserId,
        });

        if (!ownedWorkflow) {
            return;
        }

        const journalFilters: Record<string, unknown> = {
            workflowId,
            type: 'media',
        };

        const journalStorageMode = this.mapExplorerStorageModeToJournalStorageMode(storageMode);
        if (journalStorageMode) {
            journalFilters['payload.storageMode'] = journalStorageMode;
        }

        const mediaJournals = await AgentJournal.find(journalFilters)
            .select('_id agentInstanceId payload')
            .lean<Array<{
                _id: mongoose.Types.ObjectId;
                agentInstanceId: mongoose.Types.ObjectId;
                payload?: MediaJournalPayload;
            }>>();

        if (mediaJournals.length === 0) {
            return;
        }

        const existingReferences = await MediaReference.find({
            userId: ownerUserId,
            workflowId,
            journalEntryId: {
                $in: mediaJournals.map((journal) => journal._id),
            },
        })
            .select('journalEntryId')
            .lean<Array<{ journalEntryId?: mongoose.Types.ObjectId }>>();

        const referencedJournalIds = new Set(
            existingReferences
                .map((reference) => reference.journalEntryId?.toString())
                .filter((value): value is string => Boolean(value)),
        );

        const missingJournals = mediaJournals.filter((journal) => !referencedJournalIds.has(journal._id.toString()));
        if (missingJournals.length === 0) {
            return;
        }

        const agentNames = await AgentInstance.find({
            _id: { $in: missingJournals.map((journal) => journal.agentInstanceId) },
            userId: ownerUserId,
            workflowId,
        })
            .select('_id name')
            .lean<Array<{ _id: mongoose.Types.ObjectId; name: string }>>();

        const agentNameById = new Map(
            agentNames.map((agent) => [agent._id.toString(), agent.name] as const),
        );

        for (const journal of missingJournals) {
            const mediaPayload = this.extractCatalogableMediaPayload(journal.payload);
            if (!mediaPayload) {
                continue;
            }

            const metadata = this.extractLegacyMediaMetadata(mediaPayload);
            const agentName = agentNameById.get(journal.agentInstanceId.toString()) ?? metadata.generatedBy;

            try {
                await this.mediaCatalogService.registerJournalMedia({
                    userId: ownerUserId.toString(),
                    workflowId: workflowId.toString(),
                    agentInstanceId: journal.agentInstanceId.toString(),
                    journalEntryId: journal._id.toString(),
                    fileName: mediaPayload.fileName,
                    originalName: mediaPayload.fileName,
                    mimeType: mediaPayload.mimeType,
                    size: mediaPayload.size,
                    checksum: mediaPayload.checksum,
                    generatedBy: metadata.generatedBy,
                    prompt: metadata.prompt,
                    modelUsed: metadata.modelUsed,
                    createdByAgentName: agentName,
                    lastModifiedByAgentName: agentName,
                    mediaPayload,
                });
            } catch (error) {
                console.warn('[WorkflowMediaExplorerService] Legacy media backfill skipped:', error);
            }
        }
    }

    private resolveSortField(sortBy: WorkflowMediaExplorerSortBy): 'updatedAt' | 'createdAt' | 'originalName' | 'size' {
        switch (sortBy) {
            case 'name':
                return 'originalName';
            case 'createdAt':
                return 'createdAt';
            case 'size':
                return 'size';
            case 'updatedAt':
            default:
                return 'updatedAt';
        }
    }

    private derivePrimaryStorageMode(storageMode: string): WorkflowMediaExplorerStorageMode {
        switch (storageMode) {
            case 'local':
                return 'workspace';
            case 'cloud':
                return 'cloud';
            case 'db':
            default:
                return 'db';
        }
    }

        private mapExplorerStorageModeToJournalStorageMode(
            storageMode?: WorkflowMediaExplorerStorageMode,
        ): MediaJournalPayload['storageMode'] | undefined {
            switch (storageMode) {
                case 'workspace':
                    return 'local';
                case 'cloud':
                    return 'cloud';
                case 'db':
                    return 'database';
                default:
                    return undefined;
            }
        }

        private extractCatalogableMediaPayload(payload: unknown): MediaJournalPayload | null {
            if (!payload || typeof payload !== 'object') {
                return null;
            }

            const mediaPayload = payload as Partial<MediaJournalPayload>;
            if (
                typeof mediaPayload.fileName !== 'string'
                || typeof mediaPayload.mimeType !== 'string'
                || typeof mediaPayload.size !== 'number'
                || !['database', 'local', 'cloud'].includes(mediaPayload.storageMode ?? '')
            ) {
                return null;
            }

            if (mediaPayload.storageMode === 'local' && typeof mediaPayload.path !== 'string') {
                return null;
            }

            if (mediaPayload.storageMode === 'cloud') {
                const metadata = mediaPayload.metadata as Record<string, unknown> | undefined;
                const cloudKey = typeof metadata?.cloudKey === 'string' ? metadata.cloudKey : undefined;
                const cloudProvider = metadata?.cloudProvider;
                if (!cloudKey || (cloudProvider !== 's3' && cloudProvider !== 'gcs')) {
                    return null;
                }
            }

            return mediaPayload as MediaJournalPayload;
        }

        private extractLegacyMediaMetadata(mediaPayload: MediaJournalPayload): {
            generatedBy?: string;
            prompt?: string;
            modelUsed?: string;
        } {
            const metadata = mediaPayload.metadata as Record<string, unknown> | undefined;

            return {
                generatedBy: typeof metadata?.generatedBy === 'string'
                    ? metadata.generatedBy
                    : typeof mediaPayload.generationModel === 'string'
                        ? mediaPayload.generationModel
                        : undefined,
                prompt: typeof metadata?.prompt === 'string'
                    ? metadata.prompt
                    : typeof mediaPayload.generationPrompt === 'string'
                        ? mediaPayload.generationPrompt
                        : undefined,
                modelUsed: typeof metadata?.modelUsed === 'string'
                    ? metadata.modelUsed
                    : undefined,
            };
        }
}
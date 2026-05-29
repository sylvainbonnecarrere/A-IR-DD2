import mongoose from 'mongoose';
import { Workflow } from '../models/Workflow.model';
import { MediaProvenance, MediaReference, resolvePersistedMediaReferencePrimaryStorageMode } from '../models/MediaReference.model';
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

export interface WorkflowMediaLegacyRepairResult {
    workflowOwned: boolean;
    scanned: number;
    missing: number;
    stale: number;
    repaired: number;
    skipped: number;
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
            const productStorageMode = resolvePersistedMediaReferencePrimaryStorageMode(media);

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

    async repairLegacyWorkflowMediaCatalog(query: Pick<WorkflowMediaExplorerQuery, 'ownerUserId' | 'workflowId' | 'storageMode'>): Promise<WorkflowMediaLegacyRepairResult> {
        const ownerUserId = new mongoose.Types.ObjectId(query.ownerUserId);
        const workflowId = new mongoose.Types.ObjectId(query.workflowId);
        const ownedWorkflow = await Workflow.exists({
            _id: workflowId,
            userId: ownerUserId,
        });

        if (!ownedWorkflow) {
            return {
                workflowOwned: false,
                scanned: 0,
                missing: 0,
                stale: 0,
                repaired: 0,
                skipped: 0,
            };
        }

        const repairResult = await this.mediaCatalogService.repairLegacyJournalMediaCatalog({
            userId: query.ownerUserId,
            workflowId: query.workflowId,
            journalStorageMode: this.mapExplorerStorageModeToJournalStorageMode(query.storageMode),
        });

        return {
            workflowOwned: true,
            ...repairResult,
        };
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
}
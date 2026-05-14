import mongoose from 'mongoose';
import { MediaReference } from '../models/MediaReference.model';

export type WorkflowMediaExplorerStorageMode = 'db' | 'workspace' | 'cloud';
export type WorkflowMediaExplorerSortBy = 'updatedAt' | 'createdAt' | 'name' | 'size';
export type WorkflowMediaExplorerSortOrder = 'asc' | 'desc';

export interface WorkflowMediaExplorerQuery {
    ownerUserId: string;
    workflowId: string;
    storageMode?: WorkflowMediaExplorerStorageMode;
    search?: string;
    includeOrphans?: boolean;
    sortBy?: WorkflowMediaExplorerSortBy;
    sortOrder?: WorkflowMediaExplorerSortOrder;
}

export interface WorkflowMediaExplorerItem {
    mediaId: string;
    workflowId: string;
    storageMode: WorkflowMediaExplorerStorageMode;
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
    async listWorkflowMedia(query: WorkflowMediaExplorerQuery): Promise<WorkflowMediaExplorerResult> {
        const filters: Record<string, unknown> = {
            userId: new mongoose.Types.ObjectId(query.ownerUserId),
            workflowId: new mongoose.Types.ObjectId(query.workflowId),
        };

        if (!query.includeOrphans) {
            filters.isOrphan = false;
        }

        if (query.storageMode) {
            filters.primaryStorageMode = query.storageMode;
        }

        const trimmedSearch = query.search?.trim();
        if (trimmedSearch) {
            const searchRegex = new RegExp(escapeRegex(trimmedSearch), 'i');
            filters.$or = [
                { originalName: searchRegex },
                { fileName: searchRegex },
                { mimeType: searchRegex },
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
}
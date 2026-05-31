import {
    FileMetadata,
    MediaPayload,
    PersistenceConfig,
} from '../types/persistence';
import { MediaStorageService } from './mediaStorage.service';
import { MediaCatalogService } from './mediaCatalog.service';
import { WorkspacePublicationService } from './workspace/WorkspacePublicationService';

export interface MediaWriteContext {
    userId: string;
    workflowId: string;
    agentInstanceId: string;
    agentName?: string;
}

export interface RegisterJournalMediaContext extends MediaWriteContext {
    journalEntryId: string;
    mediaPayload: MediaPayload;
    metadata: FileMetadata;
}

export class MediaWriteOrchestrator {
    constructor(
        private readonly mediaStorage: MediaStorageService = new MediaStorageService(),
        private readonly mediaCatalog: MediaCatalogService = new MediaCatalogService(),
        private readonly workspacePublicationService: WorkspacePublicationService = new WorkspacePublicationService(),
    ) {}

    async storePrimaryMedia(
        file: Buffer,
        metadata: FileMetadata,
        config: PersistenceConfig & { mediaStorageMode?: 'database' | 'local' | 'cloud' },
        context: MediaWriteContext,
    ): Promise<MediaPayload> {
        if (this.resolveStorageMode(config) === 'local' && this.workspacePublicationService.canPublishToWorkflowWorkspace(context)) {
            try {
                return await this.workspacePublicationService.publishPrimaryWorkspaceMedia(file, metadata, context);
            } catch (error) {
                console.warn('[MediaWriteOrchestrator] Workspace publication failed, fallback to legacy local storage:', error);
            }
        }

        return this.mediaStorage.saveMedia(file, metadata, config, context);
    }

    async registerJournalMedia(context: RegisterJournalMediaContext) {
        return this.mediaCatalog.registerJournalMedia({
            userId: context.userId,
            workflowId: context.workflowId,
            agentInstanceId: context.agentInstanceId,
            journalEntryId: context.journalEntryId,
            fileName: context.mediaPayload.fileName,
            originalName: context.metadata.originalName,
            mimeType: context.mediaPayload.mimeType,
            size: context.mediaPayload.size,
            checksum: context.mediaPayload.checksum,
            generatedBy: context.metadata.generatedBy,
            prompt: context.metadata.prompt,
            createdByAgentName: context.agentName,
            lastModifiedByAgentName: context.agentName,
            mediaPayload: context.mediaPayload,
        });
    }

    private resolveStorageMode(config: PersistenceConfig & { mediaStorageMode?: 'database' | 'local' | 'cloud' }): 'db' | 'local' | 'cloud' {
        if (config.mediaStorage === 'db' || config.mediaStorage === 'local' || config.mediaStorage === 'cloud') {
            return config.mediaStorage;
        }

        switch (config.mediaStorageMode) {
            case 'local':
                return 'local';
            case 'cloud':
                return 'cloud';
            case 'database':
            default:
                return 'db';
        }
    }
}
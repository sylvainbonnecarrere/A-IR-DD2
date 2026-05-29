import { stat } from 'fs/promises';
import path from 'path';
import mongoose from 'mongoose';
import { AgentInstance } from '../models/AgentInstance.model';
import { AgentJournal } from '../models/AgentJournal.model';
import { Workflow } from '../models/Workflow.model';
import { IMediaReference, IUserToolRunArtifact } from '../models';
import {
    mediaReferenceMatchesJournalMediaContract,
    resolveMediaReferenceCatalogSeedFromJournalMedia,
} from '../models/MediaReference.model';
import {
    CreateMediaReferenceFromJournalParams,
    JournalMediaReferenceShape,
    MediaReferenceRepository,
    UpsertRuntimeArtifactParams,
} from '../repositories/MediaReferenceRepository';
import { MediaJournalPayload } from '../types/persistence';

export interface RegisterRuntimeOutputArtifactsParams {
    userId: string;
    workflowId: string;
    agentInstanceId: string;
    executionId: string;
    workspaceOutputRoot: string;
    artifacts: IUserToolRunArtifact[];
    agentName?: string;
}

export interface RepairLegacyJournalMediaCatalogParams {
    userId: string;
    workflowId: string;
    agentInstanceId?: string;
    journalStorageMode?: MediaJournalPayload['storageMode'];
    session?: mongoose.ClientSession;
}

export interface RepairLegacyJournalMediaCatalogResult {
    scanned: number;
    missing: number;
    stale: number;
    repaired: number;
    skipped: number;
}

export class MediaCatalogService {
    constructor(
        private readonly mediaReferenceRepository: MediaReferenceRepository = new MediaReferenceRepository(),
    ) {}

    async registerJournalMedia(params: CreateMediaReferenceFromJournalParams): Promise<IMediaReference> {
        return this.mediaReferenceRepository.createFromJournalMedia(params);
    }

    async registerRuntimeOutputArtifacts(params: RegisterRuntimeOutputArtifactsParams): Promise<IMediaReference[]> {
        const registeredArtifacts: IMediaReference[] = [];

        for (const artifact of params.artifacts) {
            const runtimeArtifact = await this.resolveRuntimeArtifactMetadata(artifact, params.workspaceOutputRoot);
            if (!runtimeArtifact) {
                continue;
            }

            registeredArtifacts.push(
                await this.mediaReferenceRepository.upsertRuntimeArtifact({
                    userId: params.userId,
                    workflowId: params.workflowId,
                    agentInstanceId: params.agentInstanceId,
                    executionId: params.executionId,
                    agentName: params.agentName,
                    ...runtimeArtifact,
                }),
            );
        }

        return registeredArtifacts;
    }

    async repairLegacyJournalMediaCatalog(
        params: RepairLegacyJournalMediaCatalogParams,
    ): Promise<RepairLegacyJournalMediaCatalogResult> {
        const userId = new mongoose.Types.ObjectId(params.userId);
        const workflowId = new mongoose.Types.ObjectId(params.workflowId);
        const journalFilters: Record<string, unknown> = {
            workflowId,
            type: 'media',
        };

        if (params.agentInstanceId) {
            journalFilters.agentInstanceId = new mongoose.Types.ObjectId(params.agentInstanceId);
        }

        if (params.journalStorageMode) {
            journalFilters['payload.storageMode'] = params.journalStorageMode;
        }

        const mediaJournalsQuery = AgentJournal.find(journalFilters)
            .select('_id agentInstanceId payload');

        if (params.session) {
            mediaJournalsQuery.session(params.session);
        }

        const mediaJournals = await mediaJournalsQuery.lean<Array<{
                _id: mongoose.Types.ObjectId;
                agentInstanceId: mongoose.Types.ObjectId;
                payload?: MediaJournalPayload;
            }>>();

        if (mediaJournals.length === 0) {
            return {
                scanned: 0,
                missing: 0,
                stale: 0,
                repaired: 0,
                skipped: 0,
            };
        }

        const existingReferences = await this.mediaReferenceRepository.findJournalReferences({
            userId,
            workflowId,
            journalEntryIds: mediaJournals.map((journal) => journal._id),
            session: params.session,
        });
        const existingReferenceByJournalId = new Map(
            existingReferences
                .filter((reference): reference is JournalMediaReferenceShape & { journalEntryId: mongoose.Types.ObjectId } => Boolean(reference.journalEntryId))
                .map((reference) => [reference.journalEntryId.toString(), reference] as const),
        );

        const repairableJournals = mediaJournals.filter((journal) => {
            const reference = existingReferenceByJournalId.get(journal._id.toString());
            return !reference || this.referenceNeedsCatalogRepair(reference, journal._id, journal.payload);
        });
        const missing = repairableJournals.filter((journal) => !existingReferenceByJournalId.has(journal._id.toString())).length;
        const stale = repairableJournals.length - missing;

        if (repairableJournals.length === 0) {
            return {
                scanned: mediaJournals.length,
                missing: 0,
                stale: 0,
                repaired: 0,
                skipped: 0,
            };
        }

        const agentNameById = await this.loadAgentNameById({
            userId,
            workflowId,
            agentInstanceIds: repairableJournals.map((journal) => journal.agentInstanceId),
            session: params.session,
        });

        let repaired = 0;
        let skipped = 0;

        for (const journal of repairableJournals) {
            const mediaPayload = this.extractCatalogableMediaPayload(journal.payload, journal._id);
            if (!mediaPayload) {
                skipped += 1;
                continue;
            }

            const metadata = this.extractLegacyMediaMetadata(mediaPayload);
            const originalName = this.extractLegacyOriginalName(mediaPayload);
            const agentName = agentNameById.get(journal.agentInstanceId.toString()) ?? metadata.generatedBy;

            try {
                await this.registerJournalMedia({
                    userId: params.userId,
                    workflowId: params.workflowId,
                    agentInstanceId: journal.agentInstanceId.toString(),
                    journalEntryId: journal._id.toString(),
                    fileName: mediaPayload.fileName,
                    originalName,
                    mimeType: mediaPayload.mimeType,
                    size: mediaPayload.size,
                    checksum: mediaPayload.checksum,
                    generatedBy: metadata.generatedBy,
                    prompt: metadata.prompt,
                    modelUsed: metadata.modelUsed,
                    createdByAgentName: agentName,
                    lastModifiedByAgentName: agentName,
                    mediaPayload,
                    session: params.session,
                });
                repaired += 1;
            } catch (error) {
                skipped += 1;
                console.warn('[MediaCatalogService] Legacy media catalog repair skipped:', error);
            }
        }

        return {
            scanned: mediaJournals.length,
            missing,
            stale,
            repaired,
            skipped,
        };
    }

    private async resolveRuntimeArtifactMetadata(
        artifact: IUserToolRunArtifact,
        workspaceOutputRoot: string,
    ): Promise<Omit<UpsertRuntimeArtifactParams, 'userId' | 'workflowId' | 'agentInstanceId' | 'executionId' | 'agentName'> | null> {
        const localPath = this.normalizeRuntimeArtifactPath(artifact.path);
        if (!localPath) {
            return null;
        }

        const relativeOutputPath = localPath.slice('output/'.length);
        const absolutePath = path.join(workspaceOutputRoot, ...relativeOutputPath.split('/'));

        let artifactStats;
        try {
            artifactStats = await stat(absolutePath);
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code === 'ENOENT') {
                return null;
            }

            throw error;
        }

        if (!artifactStats.isFile()) {
            return null;
        }

        const fileName = path.posix.basename(localPath);

        return {
            localPath,
            fileName,
            originalName: fileName,
            mimeType: this.inferArtifactMimeType(artifact, fileName),
            size: artifactStats.size,
        };
    }

    private normalizeRuntimeArtifactPath(artifactPath: string): string | null {
        const normalized = path.posix.normalize((artifactPath || '').replace(/\\/g, '/'));
        if (!normalized.startsWith('output/')) {
            return null;
        }

        return normalized;
    }

    private inferArtifactMimeType(artifact: IUserToolRunArtifact, fileName: string): string {
        if (artifact.kind === 'json') {
            return 'application/json';
        }

        if (artifact.kind === 'log') {
            return 'text/plain';
        }

        const extension = path.posix.extname(fileName).toLowerCase();

        switch (extension) {
            case '.png':
                return 'image/png';
            case '.jpg':
            case '.jpeg':
                return 'image/jpeg';
            case '.gif':
                return 'image/gif';
            case '.webp':
                return 'image/webp';
            case '.svg':
                return 'image/svg+xml';
            case '.txt':
            case '.md':
            case '.log':
            case '.csv':
                return 'text/plain';
            case '.pdf':
                return 'application/pdf';
            default:
                return 'application/octet-stream';
        }
    }

    private async loadAgentNameById(params: {
        userId: mongoose.Types.ObjectId;
        workflowId: mongoose.Types.ObjectId;
        agentInstanceIds: mongoose.Types.ObjectId[];
        session?: mongoose.ClientSession;
    }): Promise<Map<string, string>> {
        const uniqueAgentInstanceIds = Array.from(
            new Map(params.agentInstanceIds.map((id) => [id.toString(), id])).values(),
        );

        if (uniqueAgentInstanceIds.length === 0) {
            return new Map();
        }

        const agentsQuery = AgentInstance.find({
            _id: { $in: uniqueAgentInstanceIds },
            userId: params.userId,
            workflowId: params.workflowId,
        })
            .select('_id name');

        if (params.session) {
            agentsQuery.session(params.session);
        }

        const agents = await agentsQuery.lean<Array<{ _id: mongoose.Types.ObjectId; name: string }>>();

        return new Map(agents.map((agent) => [agent._id.toString(), agent.name] as const));
    }

    private extractCatalogableMediaPayload(
        payload: unknown,
        journalEntryId: mongoose.Types.ObjectId,
    ): MediaJournalPayload | null {
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

        if (!resolveMediaReferenceCatalogSeedFromJournalMedia({
            journalEntryId,
            mediaPayload: mediaPayload as MediaJournalPayload,
        })) {
            return null;
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

    private extractLegacyOriginalName(mediaPayload: MediaJournalPayload): string {
        const metadata = mediaPayload.metadata as Record<string, unknown> | undefined;
        if (typeof metadata?.originalName === 'string' && metadata.originalName.trim().length > 0) {
            return metadata.originalName.trim();
        }

        return mediaPayload.fileName;
    }

    private referenceNeedsCatalogRepair(
        reference: JournalMediaReferenceShape,
        journalEntryId: mongoose.Types.ObjectId,
        payload?: MediaJournalPayload,
    ): boolean {
        if (!payload) {
            return false;
        }

        return !mediaReferenceMatchesJournalMediaContract(reference, {
            journalEntryId,
            mediaPayload: payload,
        });
    }
}
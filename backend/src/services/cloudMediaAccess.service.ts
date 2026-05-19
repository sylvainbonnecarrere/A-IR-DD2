import mongoose from 'mongoose';
import { AgentInstance } from '../models/AgentInstance.model';
import { AgentJournal } from '../models/AgentJournal.model';
import { CloudConnectionProfile } from '../models/CloudConnectionProfile.model';
import type { CloudProvider, IMediaReference } from '../models/MediaReference.model';
import {
    CloudStorageConfig,
    CloudStorageError,
    CloudStorageErrorCodes,
    ICloudStorageStrategy,
    validateCloudConfig,
} from '../types/cloudStorage';
import { GCSStorageStrategy } from './gcsStorage.service';
import { S3StorageStrategy } from './s3Storage.service';

type CloudMediaReferenceShape = Pick<
    IMediaReference,
    'userId' | 'workflowId' | 'agentInstanceId' | 'journalEntryId' | 'cloudConnectionProfileId' | 'cloudProvider' | 'cloudBucket' | 'cloudKey'
>;

export interface ResolvedCloudMediaAccess {
    profileId: string;
    config: CloudStorageConfig;
    strategy: ICloudStorageStrategy;
}

function trimToNull(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function buildCloudStrategy(config: CloudStorageConfig): ICloudStorageStrategy {
    switch (config.provider) {
        case 's3':
            return new S3StorageStrategy();
        case 'gcs':
            return new GCSStorageStrategy();
        default:
            throw new CloudStorageError(
                'Provider cloud non supporte.',
                CloudStorageErrorCodes.PROVIDER_NOT_SUPPORTED,
            );
    }
}

function resolveConfigBucket(config: CloudStorageConfig): string | undefined {
    if (config.provider === 's3') {
        return config.s3?.bucketName;
    }

    return config.gcs?.bucketName;
}

function ensureMediaReferenceMatchesResolvedProfile(
    mediaRef: CloudMediaReferenceShape,
    config: CloudStorageConfig,
): void {
    if (mediaRef.cloudProvider && config.provider !== mediaRef.cloudProvider) {
        throw new CloudStorageError(
            'Le profil cloud resolu ne correspond pas au provider du media.',
            CloudStorageErrorCodes.INVALID_CONFIG,
            config.provider,
            {
                mediaProvider: mediaRef.cloudProvider,
                profileProvider: config.provider,
            },
        );
    }

    const configBucket = resolveConfigBucket(config);
    if (mediaRef.cloudBucket && configBucket && mediaRef.cloudBucket !== configBucket) {
        throw new CloudStorageError(
            'Le profil cloud resolu ne correspond pas au bucket du media.',
            CloudStorageErrorCodes.INVALID_CONFIG,
            config.provider,
            {
                mediaBucket: mediaRef.cloudBucket,
                profileBucket: configBucket,
            },
        );
    }
}

async function resolveProfileIdFromJournal(mediaRef: CloudMediaReferenceShape): Promise<string | null> {
    if (!mediaRef.journalEntryId) {
        return null;
    }

    const journalEntry = await AgentJournal.findOne({
        _id: mediaRef.journalEntryId,
        type: 'media',
        workflowId: mediaRef.workflowId,
        agentInstanceId: mediaRef.agentInstanceId,
    })
        .select('payload')
        .lean<{ payload?: { metadata?: Record<string, unknown> } }>();

    return trimToNull(journalEntry?.payload?.metadata?.cloudConnectionProfileId);
}

async function resolveProfileIdFromAgentInstance(
    mediaRef: CloudMediaReferenceShape,
    ownerUserId: string,
): Promise<string | null> {
    const agentInstance = await AgentInstance.findOne({
        _id: mediaRef.agentInstanceId,
        workflowId: mediaRef.workflowId,
        userId: ownerUserId,
    })
        .select('persistenceConfig.cloudConnectionProfileId')
        .lean<{ persistenceConfig?: { cloudConnectionProfileId?: string } }>();

    return trimToNull(agentInstance?.persistenceConfig?.cloudConnectionProfileId);
}

async function resolveProfileId(
    mediaRef: CloudMediaReferenceShape,
    ownerUserId: string,
): Promise<string | null> {
    return trimToNull(mediaRef.cloudConnectionProfileId)
        ?? await resolveProfileIdFromJournal(mediaRef)
        ?? await resolveProfileIdFromAgentInstance(mediaRef, ownerUserId);
}

export async function resolveCloudAccessForMediaReference(
    mediaRef: CloudMediaReferenceShape,
    ownerUserId: string,
): Promise<ResolvedCloudMediaAccess> {
    if (!trimToNull(mediaRef.cloudKey)) {
        throw new CloudStorageError(
            'Le media cloud ne reference aucune cle de stockage.',
            CloudStorageErrorCodes.INVALID_CONFIG,
            mediaRef.cloudProvider as CloudProvider | undefined,
        );
    }

    const profileId = await resolveProfileId(mediaRef, ownerUserId);
    if (!profileId) {
        throw new CloudStorageError(
            'Aucun profil cloud resolvable pour ce media.',
            CloudStorageErrorCodes.INVALID_CONFIG,
            mediaRef.cloudProvider as CloudProvider | undefined,
            {
                workflowId: mediaRef.workflowId.toString(),
                agentInstanceId: mediaRef.agentInstanceId.toString(),
                journalEntryId: mediaRef.journalEntryId?.toString(),
            },
        );
    }

    if (!mongoose.Types.ObjectId.isValid(profileId)) {
        throw new CloudStorageError(
            'Le profil cloud resolu a un identifiant invalide.',
            CloudStorageErrorCodes.INVALID_CONFIG,
            mediaRef.cloudProvider as CloudProvider | undefined,
            { profileId },
        );
    }

    const profile = await CloudConnectionProfile.findOne({
        _id: profileId,
        userId: ownerUserId,
    });

    if (!profile) {
        throw new CloudStorageError(
            'Le profil cloud resolu est introuvable pour cet utilisateur.',
            CloudStorageErrorCodes.INVALID_CONFIG,
            mediaRef.cloudProvider as CloudProvider | undefined,
            { profileId },
        );
    }

    if (!profile.enabled) {
        throw new CloudStorageError(
            'Le profil cloud resolu est desactive.',
            CloudStorageErrorCodes.INVALID_CONFIG,
            mediaRef.cloudProvider as CloudProvider | undefined,
            { profileId, statusState: profile.statusState },
        );
    }

    const config = profile.toDecryptedCloudStorageConfig();
    if (!config) {
        throw new CloudStorageError(
            'Le profil cloud resolu ne contient pas de secret exploitable.',
            CloudStorageErrorCodes.INVALID_CONFIG,
            mediaRef.cloudProvider as CloudProvider | undefined,
            { profileId, statusState: profile.statusState },
        );
    }

    const validation = validateCloudConfig(config);
    if (!validation.valid) {
        throw new CloudStorageError(
            'La configuration cloud resolue est invalide.',
            CloudStorageErrorCodes.INVALID_CONFIG,
            config.provider,
            { profileId, errors: validation.errors },
        );
    }

    ensureMediaReferenceMatchesResolvedProfile(mediaRef, config);

    const strategy = buildCloudStrategy(config);
    await strategy.initialize(config);

    return {
        profileId,
        config,
        strategy,
    };
}
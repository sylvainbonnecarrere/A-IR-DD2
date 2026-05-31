import React from 'react';
import {
    CloudConnectionProfileDraft,
    CloudConnectionStatusState,
    CloudProvider,
    CloudStorageConfig,
} from '../../types';
import { ToggleSwitch } from '../UI';
import { PlayIcon, TrashIcon } from '../Icons';
import { CloudStorageConfigForm } from '../modals/CloudStorageConfigForm';

interface CloudConnectionProfileCardProps {
    profile: CloudConnectionProfileDraft;
    onChange: (updated: CloudConnectionProfileDraft) => void;
    onDelete: () => void;
    onTest?: () => void;
    isTesting?: boolean;
}

const STATUS_LABELS: Record<CloudConnectionStatusState, string> = {
    configured: 'Configure',
    invalid: 'Invalide',
    missing_secret: 'Secret manquant',
    never_tested: 'Jamais teste',
    disabled: 'Desactive',
};

const STATUS_CLASSES: Record<CloudConnectionStatusState, string> = {
    configured: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
    invalid: 'bg-red-500/20 text-red-300 border border-red-500/30',
    missing_secret: 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
    never_tested: 'bg-slate-500/20 text-slate-300 border border-slate-500/30',
    disabled: 'bg-gray-600/20 text-gray-300 border border-gray-500/30',
};

function buildCloudStorageConfig(profile: CloudConnectionProfileDraft): CloudStorageConfig {
    if (profile.provider === 's3') {
        return {
            provider: 's3',
            s3: {
                accessKeyId: profile.secretInput?.accessKeyId || '',
                secretAccessKey: profile.secretInput?.secretAccessKey || '',
                bucketName: profile.target.bucketName || '',
                region: profile.target.region || '',
                endpoint: profile.target.endpoint || undefined,
                forcePathStyle: profile.target.forcePathStyle,
                keyPrefix: profile.target.keyPrefix || undefined,
            },
        };
    }

    return {
        provider: 'gcs',
        gcs: {
            projectId: profile.target.projectId || '',
            bucketName: profile.target.bucketName || '',
            serviceAccountKey: profile.secretInput?.serviceAccountKey || '',
            location: profile.target.location || undefined,
            keyPrefix: profile.target.keyPrefix || undefined,
        },
    };
}

function applyCloudStorageConfig(
    profile: CloudConnectionProfileDraft,
    config: CloudStorageConfig,
): CloudConnectionProfileDraft {
    if (config.provider === 's3') {
        return {
            ...profile,
            provider: 's3',
            target: {
                bucketName: config.s3?.bucketName || '',
                region: config.s3?.region || '',
                endpoint: config.s3?.endpoint || null,
                forcePathStyle: config.s3?.forcePathStyle ?? profile.target.forcePathStyle ?? false,
                keyPrefix: config.s3?.keyPrefix ?? profile.target.keyPrefix ?? null,
            },
            secretInput: {
                accessKeyId: config.s3?.accessKeyId || '',
                secretAccessKey: config.s3?.secretAccessKey || '',
            },
        };
    }

    return {
        ...profile,
        provider: 'gcs',
        target: {
            bucketName: config.gcs?.bucketName || '',
            projectId: config.gcs?.projectId || '',
            location: config.gcs?.location ?? profile.target.location ?? null,
            keyPrefix: config.gcs?.keyPrefix ?? profile.target.keyPrefix ?? null,
        },
        secretInput: {
            serviceAccountKey: config.gcs?.serviceAccountKey || '',
        },
    };
}

function getProviderLabel(provider: CloudProvider): string {
    return provider === 's3' ? 'S3' : 'GCS';
}

export const CloudConnectionProfileCard: React.FC<CloudConnectionProfileCardProps> = ({
    profile,
    onChange,
    onDelete,
    onTest,
    isTesting = false,
}) => {
    const config = buildCloudStorageConfig(profile);

    return (
        <div className="border border-gray-600 rounded-lg p-4 space-y-4 bg-gray-750">
            <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 space-y-3">
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                value={profile.displayName}
                                onChange={(event) => onChange({ ...profile, displayName: event.target.value })}
                                placeholder="ex: Media S3"
                                className="flex-1 p-2 text-sm bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-200"
                            />
                            <span className="px-2 py-1 rounded text-xs font-medium bg-gray-700 text-gray-300">
                                {getProviderLabel(profile.provider)}
                            </span>
                            <span className={`px-2 py-1 rounded text-xs font-medium ${STATUS_CLASSES[profile.status.state]}`}>
                                {STATUS_LABELS[profile.status.state]}
                            </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400">
                            <span>Bucket: {profile.target.bucketName || 'non defini'}</span>
                            {profile.provider === 's3' && profile.target.region && (
                                <span>Region: {profile.target.region}</span>
                            )}
                            {profile.provider === 'gcs' && profile.target.projectId && (
                                <span>Project: {profile.target.projectId}</span>
                            )}
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={onDelete}
                        className="p-2 text-gray-400 hover:text-red-400 transition-colors"
                        title="Supprimer ce profil"
                    >
                        <TrashIcon width={16} height={16} />
                    </button>
                </div>

                <div className="rounded-lg border border-gray-700 bg-gray-800/60 px-3 py-3">
                    <div className="flex flex-col gap-2 text-sm text-gray-200">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="font-medium text-gray-100">Profil actif</p>
                                <p className="text-xs text-gray-400">
                                    Desactivez ce profil pour le masquer de la selection des agents sans le supprimer.
                                </p>
                            </div>
                            <ToggleSwitch
                                checked={profile.enabled}
                                onChange={(enabled) => onChange({ ...profile, enabled })}
                                label={profile.enabled ? 'Actif' : 'Inactif'}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {profile.hasSecretMaterial && (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200 space-y-1">
                    <p>Secret deja stocke de maniere securisee.</p>
                    {profile.provider === 's3' && profile.secretSummary.accessKeyIdMasked && (
                        <p>Access key: {profile.secretSummary.accessKeyIdMasked}</p>
                    )}
                    {profile.provider === 'gcs' && profile.secretSummary.serviceAccountEmailMasked && (
                        <p>Service account: {profile.secretSummary.serviceAccountEmailMasked}</p>
                    )}
                    <p>Renseignez un nouveau secret ci-dessous uniquement si vous voulez le remplacer.</p>
                </div>
            )}

            {profile.status.lastValidationMessage && profile.status.state === 'invalid' && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                    {profile.status.lastValidationMessage}
                </div>
            )}

            <CloudStorageConfigForm
                config={config}
                onChange={(nextConfig) => onChange(applyCloudStorageConfig(profile, nextConfig))}
            />

            <div className="flex items-center justify-between gap-3 text-xs text-gray-400">
                <span>
                    {profile.id
                        ? 'Le test utilise la version sauvegardee du profil.'
                        : 'Enregistrez d abord le profil avant de lancer un test.'}
                </span>
                <button
                    type="button"
                    onClick={onTest}
                    disabled={!profile.id || !onTest || isTesting}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <PlayIcon width={14} height={14} />
                    {isTesting ? 'Test...' : 'Tester'}
                </button>
            </div>
        </div>
    );
};
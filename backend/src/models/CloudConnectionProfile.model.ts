import mongoose, { Document, Schema } from 'mongoose';
import { encrypt, decrypt } from '../utils/encryption';
import type { CloudConnectionTestResult, CloudStorageConfig } from '../types/cloudStorage';

export type CloudConnectionProvider = 's3' | 'gcs';
export type CloudConnectionStatusState = 'configured' | 'invalid' | 'missing_secret' | 'never_tested' | 'disabled';
export type CloudSecretKind = 'aws_access_key_pair' | 'gcp_service_account_key_json';

export interface ICloudConnectionProfileTarget {
    bucketName: string;
    region?: string;
    endpoint?: string;
    forcePathStyle?: boolean;
    keyPrefix?: string;
    projectId?: string;
    location?: string;
    serviceAccountEmail?: string | null;
    accessKeyIdHint?: string | null;
}

export interface ICloudConnectionSecretEnvelope {
    schemeVersion: number;
    secretKind?: CloudSecretKind;
    payloadEncrypted?: string;
    rotatedAt?: Date | null;
}

export type CloudConnectionProfileConfig =
    | {
        provider: 's3';
        s3: {
            accessKeyId?: string;
            secretAccessKey?: string;
            bucketName: string;
            region: string;
            endpoint?: string;
            forcePathStyle?: boolean;
            keyPrefix?: string;
        };
    }
    | {
        provider: 'gcs';
        gcs: {
            projectId: string;
            bucketName: string;
            serviceAccountKey?: string;
            location?: string;
            keyPrefix?: string;
        };
    };

export interface ICloudConnectionProfile extends Document {
    userId: mongoose.Types.ObjectId;
    displayName: string;
    provider: CloudConnectionProvider;
    enabled: boolean;
    target: ICloudConnectionProfileTarget;
    secretEnvelope?: ICloudConnectionSecretEnvelope;
    statusState: CloudConnectionStatusState;
    lastValidatedAt?: Date | null;
    lastErrorCode?: string | null;
    lastValidationMessage?: string | null;
    createdAt: Date;
    updatedAt: Date;
    setTargetConfig(config: CloudConnectionProfileConfig): void;
    setSecretMaterial(config: CloudConnectionProfileConfig | CloudStorageConfig): void;
    clearSecretMaterial(): void;
    toDecryptedCloudStorageConfig(): CloudStorageConfig | null;
    hasSecretMaterial(): boolean;
    getSafeSecretSummary(): Record<string, unknown>;
    applyValidationResult(result: CloudConnectionTestResult): void;
}

const CloudConnectionProfileTargetSchema = new Schema<ICloudConnectionProfileTarget>({
    bucketName: {
        type: String,
        required: true,
        trim: true
    },
    region: {
        type: String,
        trim: true,
        default: undefined
    },
    endpoint: {
        type: String,
        trim: true,
        default: undefined
    },
    forcePathStyle: {
        type: Boolean,
        default: undefined
    },
    keyPrefix: {
        type: String,
        trim: true,
        default: undefined
    },
    projectId: {
        type: String,
        trim: true,
        default: undefined
    },
    location: {
        type: String,
        trim: true,
        default: undefined
    },
    serviceAccountEmail: {
        type: String,
        trim: true,
        default: null
    },
    accessKeyIdHint: {
        type: String,
        trim: true,
        default: null
    }
}, { _id: false });

const CloudConnectionSecretEnvelopeSchema = new Schema<ICloudConnectionSecretEnvelope>({
    schemeVersion: {
        type: Number,
        default: 1
    },
    secretKind: {
        type: String,
        enum: ['aws_access_key_pair', 'gcp_service_account_key_json'],
        default: undefined
    },
    payloadEncrypted: {
        type: String,
        default: undefined
    },
    rotatedAt: {
        type: Date,
        default: null
    }
}, { _id: false });

const CloudConnectionProfileSchema = new Schema<ICloudConnectionProfile>({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    displayName: {
        type: String,
        required: true,
        trim: true,
        minlength: 1,
        maxlength: 100
    },
    provider: {
        type: String,
        required: true,
        enum: ['s3', 'gcs']
    },
    enabled: {
        type: Boolean,
        default: true
    },
    target: {
        type: CloudConnectionProfileTargetSchema,
        required: true
    },
    secretEnvelope: {
        type: CloudConnectionSecretEnvelopeSchema,
        default: undefined
    },
    statusState: {
        type: String,
        required: true,
        enum: ['configured', 'invalid', 'missing_secret', 'never_tested', 'disabled'],
        default: 'missing_secret'
    },
    lastValidatedAt: {
        type: Date,
        default: null
    },
    lastErrorCode: {
        type: String,
        trim: true,
        default: null
    },
    lastValidationMessage: {
        type: String,
        trim: true,
        default: null
    }
}, {
    timestamps: true,
    collection: 'cloud_connection_profiles'
});

CloudConnectionProfileSchema.index({ userId: 1, displayName: 1 }, { unique: true });
CloudConnectionProfileSchema.index({ userId: 1, updatedAt: -1 });

function trimToUndefined(value?: string | null): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function extractServiceAccountEmail(serviceAccountKey?: string): string | null {
    if (!serviceAccountKey) {
        return null;
    }

    let parsed: any;
    try {
        parsed = JSON.parse(serviceAccountKey);
    } catch (error) {
        throw new Error('Clé de service account invalide (JSON mal formé)');
    }

    if (typeof parsed?.client_email !== 'string' || parsed.client_email.trim().length === 0) {
        throw new Error('Clé de service account invalide (client_email manquant)');
    }

    return parsed.client_email.trim();
}

function maskEmail(email?: string | null): string | null {
    if (!email) {
        return null;
    }

    const parts = email.split('@');
    if (parts.length !== 2) {
        return '••••';
    }

    const [localPart, domain] = parts;
    if (localPart.length <= 2) {
        return `${localPart.slice(0, 1)}••@${domain}`;
    }

    return `${localPart.slice(0, 2)}••••@${domain}`;
}

function sanitizeValidationMessage(message?: string | null): string | null {
    if (!message) {
        return null;
    }

    const normalized = message.replace(/\s+/g, ' ').trim();
    return normalized.length > 500 ? normalized.slice(0, 500) : normalized;
}

CloudConnectionProfileSchema.methods.setTargetConfig = function (config: CloudConnectionProfileConfig): void {
    if (config.provider === 's3') {
        this.provider = 's3';
        this.target.bucketName = config.s3.bucketName;
        this.target.region = config.s3.region;
        this.target.endpoint = trimToUndefined(config.s3.endpoint);
        this.target.forcePathStyle = config.s3.forcePathStyle ?? undefined;
        this.target.keyPrefix = trimToUndefined(config.s3.keyPrefix);
        this.target.projectId = undefined;
        this.target.location = undefined;
        this.target.serviceAccountEmail = null;

        if (config.s3.accessKeyId) {
            this.target.accessKeyIdHint = config.s3.accessKeyId.slice(-4);
        }
    } else {
        this.provider = 'gcs';
        this.target.bucketName = config.gcs.bucketName;
        this.target.projectId = config.gcs.projectId;
        this.target.location = trimToUndefined(config.gcs.location);
        this.target.keyPrefix = trimToUndefined(config.gcs.keyPrefix);
        this.target.region = undefined;
        this.target.endpoint = undefined;
        this.target.forcePathStyle = undefined;
        this.target.accessKeyIdHint = null;

        if (config.gcs.serviceAccountKey) {
            this.target.serviceAccountEmail = extractServiceAccountEmail(config.gcs.serviceAccountKey);
        }
    }
};

CloudConnectionProfileSchema.methods.setSecretMaterial = function (config: CloudConnectionProfileConfig | CloudStorageConfig): void {
    this.setTargetConfig(config as CloudConnectionProfileConfig);

    if (config.provider === 's3') {
        const accessKeyId = config.s3?.accessKeyId;
        const secretAccessKey = config.s3?.secretAccessKey;

        if (!accessKeyId || !secretAccessKey) {
            throw new Error('Configuration S3 invalide: credentials requis');
        }

        const payload = JSON.stringify({ accessKeyId, secretAccessKey });
        this.secretEnvelope = {
            schemeVersion: 1,
            secretKind: 'aws_access_key_pair',
            payloadEncrypted: encrypt(payload, this.userId.toString()),
            rotatedAt: new Date()
        };
    } else {
        const serviceAccountKey = config.gcs?.serviceAccountKey;
        if (!serviceAccountKey) {
            throw new Error('Configuration GCS invalide: serviceAccountKey requis');
        }

        // Force validation/extraction before encrypting.
        this.target.serviceAccountEmail = extractServiceAccountEmail(serviceAccountKey);
        this.secretEnvelope = {
            schemeVersion: 1,
            secretKind: 'gcp_service_account_key_json',
            payloadEncrypted: encrypt(serviceAccountKey, this.userId.toString()),
            rotatedAt: new Date()
        };
    }

    this.statusState = this.enabled ? 'never_tested' : 'disabled';
    this.lastValidatedAt = null;
    this.lastErrorCode = null;
    this.lastValidationMessage = null;
};

CloudConnectionProfileSchema.methods.clearSecretMaterial = function (): void {
    this.secretEnvelope = undefined;
    this.statusState = this.enabled ? 'missing_secret' : 'disabled';
    this.lastValidatedAt = null;
    this.lastErrorCode = null;
    this.lastValidationMessage = null;
    this.target.accessKeyIdHint = null;
    this.target.serviceAccountEmail = null;
};

CloudConnectionProfileSchema.methods.toDecryptedCloudStorageConfig = function (): CloudStorageConfig | null {
    if (!this.secretEnvelope?.payloadEncrypted) {
        return null;
    }

    if (this.provider === 's3') {
        const decrypted = decrypt(this.secretEnvelope.payloadEncrypted, this.userId.toString());
        const parsed = JSON.parse(decrypted);

        return {
            provider: 's3',
            s3: {
                accessKeyId: parsed.accessKeyId,
                secretAccessKey: parsed.secretAccessKey,
                bucketName: this.target.bucketName,
                region: this.target.region || '',
                endpoint: trimToUndefined(this.target.endpoint),
                forcePathStyle: this.target.forcePathStyle,
                keyPrefix: trimToUndefined(this.target.keyPrefix)
            }
        };
    }

    const decrypted = decrypt(this.secretEnvelope.payloadEncrypted, this.userId.toString());

    return {
        provider: 'gcs',
        gcs: {
            projectId: this.target.projectId || '',
            bucketName: this.target.bucketName,
            serviceAccountKey: decrypted,
            location: trimToUndefined(this.target.location),
            keyPrefix: trimToUndefined(this.target.keyPrefix)
        }
    };
};

CloudConnectionProfileSchema.methods.hasSecretMaterial = function (): boolean {
    return !!this.secretEnvelope?.payloadEncrypted;
};

CloudConnectionProfileSchema.methods.getSafeSecretSummary = function (): Record<string, unknown> {
    if (this.provider === 's3') {
        return {
            accessKeyIdMasked: this.target.accessKeyIdHint ? `••••${this.target.accessKeyIdHint}` : null,
            secretAccessKeyPresent: this.hasSecretMaterial()
        };
    }

    return {
        serviceAccountEmailMasked: maskEmail(this.target.serviceAccountEmail),
        serviceAccountKeyPresent: this.hasSecretMaterial()
    };
};

CloudConnectionProfileSchema.methods.applyValidationResult = function (result: CloudConnectionTestResult): void {
    this.lastValidatedAt = new Date();

    if (!this.enabled) {
        this.statusState = 'disabled';
        this.lastErrorCode = null;
        this.lastValidationMessage = null;
        return;
    }

    if (!this.hasSecretMaterial()) {
        this.statusState = 'missing_secret';
        this.lastErrorCode = null;
        this.lastValidationMessage = null;
        return;
    }

    if (result.success) {
        this.statusState = 'configured';
        this.lastErrorCode = null;
        this.lastValidationMessage = null;
        return;
    }

    this.statusState = 'invalid';
    this.lastErrorCode = result.details?.errorCode ?? null;
    this.lastValidationMessage = sanitizeValidationMessage(result.message ?? result.details?.errorMessage);
};

export const CloudConnectionProfile = mongoose.model<ICloudConnectionProfile>('CloudConnectionProfile', CloudConnectionProfileSchema);
import mongoose, { Document, Schema } from 'mongoose';

export type SecretMetadataScopeType = 'user' | 'workspace' | 'platform';
export type SecretMetadataStatus = 'active' | 'rotating' | 'revoked';

export interface ISecretMetadata extends Document {
    ownerUserId: mongoose.Types.ObjectId;
    alias: string;
    scopeType: SecretMetadataScopeType;
    scopeId?: mongoose.Types.ObjectId | null;
    provider?: string | null;
    status: SecretMetadataStatus;
    lastRotatedAt?: Date | null;
    lastUsedAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

const SecretMetadataSchema = new Schema<ISecretMetadata>({
    ownerUserId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    alias: {
        type: String,
        required: true,
        trim: true,
        minlength: 1,
        maxlength: 120
    },
    scopeType: {
        type: String,
        required: true,
        enum: ['user', 'workspace', 'platform']
    },
    scopeId: {
        type: Schema.Types.ObjectId,
        default: null
    },
    provider: {
        type: String,
        trim: true,
        default: null
    },
    status: {
        type: String,
        required: true,
        enum: ['active', 'rotating', 'revoked'],
        default: 'active'
    },
    lastRotatedAt: {
        type: Date,
        default: null
    },
    lastUsedAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true,
    collection: 'secrets_metadata'
});

SecretMetadataSchema.index(
    { ownerUserId: 1, scopeType: 1, scopeId: 1, alias: 1 },
    { unique: true, name: 'uq_secrets_metadata_owner_scope_alias' }
);

SecretMetadataSchema.index(
    { ownerUserId: 1, status: 1, updatedAt: -1 },
    { name: 'idx_secrets_metadata_owner_status_updated' }
);

export const SecretMetadata = mongoose.model<ISecretMetadata>('SecretMetadata', SecretMetadataSchema);
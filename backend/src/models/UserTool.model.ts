import mongoose, { Document, Schema } from 'mongoose';

export type UserToolScopeType = 'native' | 'user';
export type UserToolRuntime = 'typescript' | 'python';
export type UserToolStatus = 'draft' | 'ready' | 'disabled' | 'deprecated';
export type UserToolTrustLevel = 'internal' | 'user_private' | 'unverified';
export type UserToolSourceMode = 'inline' | 'path';
export type UserToolBuildStatus = 'not_built' | 'building' | 'built' | 'failed';
export type UserToolValidationStatus = 'unknown' | 'valid' | 'invalid';
export type UserToolNetworkMode = 'none' | 'restricted';

export interface IUserToolVersion {
    versionTag: string;
    contentHash: string;
    sourceMode: UserToolSourceMode;
    sourcePath?: string | null;
    sourceInline?: string | null;
    entrypoint?: string | null;
    createdAt: Date;
    createdBy?: mongoose.Types.ObjectId | null;
    buildStatus: UserToolBuildStatus;
    validationStatus: UserToolValidationStatus;
}

export interface IUserToolDependencies {
    npm: string[];
    python: string[];
}

export interface IUserToolPolicy {
    networkMode: UserToolNetworkMode;
    writablePaths?: string[];
    secretAliases?: string[];
    timeoutSeconds?: number;
    maxMemoryMb?: number;
}

export interface IUserTool extends Document {
    ownerUserId: mongoose.Types.ObjectId | null;
    workspaceId: mongoose.Types.ObjectId | null;
    scopeType: UserToolScopeType;
    workflowId?: mongoose.Types.ObjectId | null;
    name: string;
    displayName?: string;
    description: string;
    runtime: UserToolRuntime;
    status: UserToolStatus;
    trustLevel: UserToolTrustLevel;
    currentVersion: IUserToolVersion;
    versions: IUserToolVersion[];
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
    tags: string[];
    dependencies: IUserToolDependencies;
    policy: IUserToolPolicy;
    isReadonly: boolean;
    isEnabled: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const UserToolVersionSchema = new Schema<IUserToolVersion>({
    versionTag: { type: String, required: true, trim: true },
    contentHash: { type: String, required: true, trim: true },
    sourceMode: { type: String, required: true, enum: ['inline', 'path'] },
    sourcePath: { type: String, trim: true, default: null },
    sourceInline: { type: String, default: null },
    entrypoint: { type: String, trim: true, default: null },
    createdAt: { type: Date, required: true, default: Date.now },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    buildStatus: {
        type: String,
        required: true,
        enum: ['not_built', 'building', 'built', 'failed'],
        default: 'not_built'
    },
    validationStatus: {
        type: String,
        required: true,
        enum: ['unknown', 'valid', 'invalid'],
        default: 'unknown'
    }
}, { _id: false });

const UserToolDependenciesSchema = new Schema<IUserToolDependencies>({
    npm: [{ type: String, trim: true }],
    python: [{ type: String, trim: true }]
}, { _id: false });

const UserToolPolicySchema = new Schema<IUserToolPolicy>({
    networkMode: {
        type: String,
        required: true,
        enum: ['none', 'restricted'],
        default: 'none'
    },
    writablePaths: [{ type: String, trim: true }],
    secretAliases: [{ type: String, trim: true }],
    timeoutSeconds: { type: Number, min: 1 },
    maxMemoryMb: { type: Number, min: 1 }
}, { _id: false });

const UserToolSchema = new Schema<IUserTool>({
    ownerUserId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    workspaceId: {
        type: Schema.Types.ObjectId,
        ref: 'Workspace',
        default: null
    },
    scopeType: {
        type: String,
        required: true,
        enum: ['native', 'user']
    },
    workflowId: {
        type: Schema.Types.ObjectId,
        ref: 'Workflow',
        default: null
    },
    name: {
        type: String,
        required: true,
        trim: true,
        minlength: 1,
        maxlength: 100
    },
    displayName: {
        type: String,
        trim: true,
        maxlength: 150
    },
    description: {
        type: String,
        required: true,
        trim: true,
        maxlength: 1000
    },
    runtime: {
        type: String,
        required: true,
        enum: ['typescript', 'python']
    },
    status: {
        type: String,
        required: true,
        enum: ['draft', 'ready', 'disabled', 'deprecated'],
        default: 'draft'
    },
    trustLevel: {
        type: String,
        required: true,
        enum: ['internal', 'user_private', 'unverified'],
        default: 'unverified'
    },
    currentVersion: {
        type: UserToolVersionSchema,
        required: true
    },
    versions: {
        type: [UserToolVersionSchema],
        default: []
    },
    inputSchema: {
        type: Schema.Types.Mixed,
        required: true,
        default: () => ({})
    },
    outputSchema: {
        type: Schema.Types.Mixed,
        required: true,
        default: () => ({})
    },
    tags: [{ type: String, trim: true, maxlength: 50 }],
    dependencies: {
        type: UserToolDependenciesSchema,
        default: () => ({ npm: [], python: [] })
    },
    policy: {
        type: UserToolPolicySchema,
        default: () => ({ networkMode: 'none' })
    },
    isReadonly: {
        type: Boolean,
        default: false
    },
    isEnabled: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true,
    collection: 'user_tools'
});

UserToolSchema.index(
    { scopeType: 1, name: 1 },
    {
        unique: true,
        partialFilterExpression: { scopeType: 'native', ownerUserId: null },
        name: 'uq_user_tools_native_name'
    }
);

UserToolSchema.index(
    { ownerUserId: 1, workflowId: 1, name: 1 },
    {
        unique: true,
        partialFilterExpression: { scopeType: 'user' },
        name: 'uq_user_tools_owner_workflow_name'
    }
);

UserToolSchema.index(
    { ownerUserId: 1, workflowId: 1, isEnabled: 1, status: 1, name: 1 },
    { name: 'idx_user_tools_owner_workflow_enabled_status_name' }
);

UserToolSchema.index(
    { workspaceId: 1, updatedAt: -1 },
    {
        partialFilterExpression: { workspaceId: { $type: 'objectId' } },
        name: 'idx_user_tools_workspace_updated'
    }
);

export const UserTool = mongoose.model<IUserTool>('UserTool', UserToolSchema);
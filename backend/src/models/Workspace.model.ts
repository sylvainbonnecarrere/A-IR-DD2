import mongoose, { Document, Schema } from 'mongoose';

export type WorkspaceScopeType = 'project' | 'workflow';
export type WorkspaceStatus = 'active' | 'missing' | 'corrupted' | 'archived';
export type WorkspaceHealthStatus = 'healthy' | 'warning' | 'error';

export interface IWorkspaceRuntimeRoots {
    sourceRoot: string;
    manifestsRoot: string;
    buildRoot: string;
    outputRoot: string;
}

export interface IWorkspaceManifests {
    packageJson?: boolean;
    packageLockJson?: boolean;
    requirementsTxt?: boolean;
    pyprojectToml?: boolean;
}

export interface IWorkspaceQuotas {
    maxBytes?: number;
    maxFiles?: number;
}

export interface IWorkspace extends Document {
    ownerUserId: mongoose.Types.ObjectId;
    scopeType: WorkspaceScopeType;
    scopeId: mongoose.Types.ObjectId;
    logicalRoot: string;
    runtimeRoots: IWorkspaceRuntimeRoots;
    manifests: IWorkspaceManifests;
    status: WorkspaceStatus;
    quotas?: IWorkspaceQuotas;
    snapshotVersion?: number;
    notes?: string[];
    lastHealthStatus?: WorkspaceHealthStatus;
    lastScanAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

const WorkspaceRuntimeRootsSchema = new Schema<IWorkspaceRuntimeRoots>({
    sourceRoot: { type: String, required: true, trim: true },
    manifestsRoot: { type: String, required: true, trim: true },
    buildRoot: { type: String, required: true, trim: true },
    outputRoot: { type: String, required: true, trim: true }
}, { _id: false });

const WorkspaceManifestsSchema = new Schema<IWorkspaceManifests>({
    packageJson: { type: Boolean, default: false },
    packageLockJson: { type: Boolean, default: false },
    requirementsTxt: { type: Boolean, default: false },
    pyprojectToml: { type: Boolean, default: false }
}, { _id: false });

const WorkspaceQuotasSchema = new Schema<IWorkspaceQuotas>({
    maxBytes: { type: Number, min: 0 },
    maxFiles: { type: Number, min: 0 }
}, { _id: false });

const WorkspaceSchema = new Schema<IWorkspace>({
    ownerUserId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    scopeType: {
        type: String,
        required: true,
        enum: ['project', 'workflow']
    },
    scopeId: {
        type: Schema.Types.ObjectId,
        required: true
    },
    logicalRoot: {
        type: String,
        required: true,
        trim: true
    },
    runtimeRoots: {
        type: WorkspaceRuntimeRootsSchema,
        required: true
    },
    manifests: {
        type: WorkspaceManifestsSchema,
        default: () => ({})
    },
    status: {
        type: String,
        required: true,
        enum: ['active', 'missing', 'corrupted', 'archived'],
        default: 'active'
    },
    quotas: {
        type: WorkspaceQuotasSchema,
        default: undefined
    },
    snapshotVersion: {
        type: Number,
        min: 0,
        default: 1
    },
    notes: [{
        type: String,
        trim: true,
        maxlength: 500
    }],
    lastHealthStatus: {
        type: String,
        enum: ['healthy', 'warning', 'error'],
        default: undefined
    },
    lastScanAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true,
    collection: 'workspaces'
});

WorkspaceSchema.index(
    { ownerUserId: 1, scopeType: 1, scopeId: 1 },
    { unique: true, name: 'uq_workspace_owner_scope' }
);

WorkspaceSchema.index(
    { ownerUserId: 1, status: 1, updatedAt: -1 },
    { name: 'idx_workspace_owner_status_updated' }
);

export const Workspace = mongoose.model<IWorkspace>('Workspace', WorkspaceSchema);
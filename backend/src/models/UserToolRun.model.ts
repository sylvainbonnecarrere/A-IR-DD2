import mongoose, { Document, Schema } from 'mongoose';

export type UserToolRunLaunchContext = 'editor_test' | 'workflow_run' | 'system_validation';
export type UserToolRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'stopped' | 'timed_out';
export type UserToolRunRuntime = 'typescript' | 'python';
export type UserToolRunRunner = 'docker_sandbox' | 'docker_rootless' | 'firecracker';
export type UserToolRunNetworkMode = 'none' | 'restricted';
export type UserToolRunArtifactKind = 'file' | 'json' | 'log';

export interface IUserToolRunArtifact {
    path: string;
    kind: UserToolRunArtifactKind;
}

export interface IUserToolRunOutputs {
    result?: unknown;
    stdout?: string;
    stderr?: string;
    artifacts?: IUserToolRunArtifact[];
}

export interface IUserToolRunPolicySnapshot {
    networkMode: UserToolRunNetworkMode;
    timeoutSeconds?: number;
    maxMemoryMb?: number;
    secretAliases?: string[];
}

export interface IUserToolRunTiming {
    queuedAt?: Date | null;
    startedAt?: Date | null;
    finishedAt?: Date | null;
    durationMs?: number | null;
}

export interface IUserToolRunResourceUsage {
    peakMemoryMb?: number | null;
    cpuMs?: number | null;
    wallTimeMs?: number | null;
    memoryLimitMb?: number | null;
}

export interface IUserToolRunError {
    code?: string;
    subsystem?: 'runner' | 'wrapper' | 'user_code' | 'dependency' | 'sandbox_runtime' | 'unknown' | 'build_preparation' | 'runtime_readiness' | 'validation';
    failureKind?: string;
    message: string;
    retryable?: boolean;
}

export interface IUserToolRun extends Document {
    executionId: string;
    ownerUserId: mongoose.Types.ObjectId;
    toolId: mongoose.Types.ObjectId;
    toolVersionTag: string;
    toolContentHash: string;
    workflowId?: mongoose.Types.ObjectId | null;
    agentPrototypeId?: mongoose.Types.ObjectId | null;
    agentInstanceId?: mongoose.Types.ObjectId | null;
    launchContext: UserToolRunLaunchContext;
    status: UserToolRunStatus;
    runtime: UserToolRunRuntime;
    runner: UserToolRunRunner;
    inputs: Record<string, unknown>;
    outputs?: IUserToolRunOutputs | null;
    policySnapshot: IUserToolRunPolicySnapshot;
    timing: IUserToolRunTiming;
    resourceUsage?: IUserToolRunResourceUsage;
    error?: IUserToolRunError | null;
    createdAt: Date;
    updatedAt: Date;
}

const UserToolRunArtifactSchema = new Schema<IUserToolRunArtifact>({
    path: { type: String, required: true, trim: true },
    kind: { type: String, required: true, enum: ['file', 'json', 'log'] }
}, { _id: false });

const UserToolRunOutputsSchema = new Schema<IUserToolRunOutputs>({
    result: { type: Schema.Types.Mixed, default: undefined },
    stdout: { type: String, default: undefined },
    stderr: { type: String, default: undefined },
    artifacts: { type: [UserToolRunArtifactSchema], default: undefined }
}, { _id: false });

const UserToolRunPolicySnapshotSchema = new Schema<IUserToolRunPolicySnapshot>({
    networkMode: {
        type: String,
        required: true,
        enum: ['none', 'restricted']
    },
    timeoutSeconds: { type: Number, min: 1 },
    maxMemoryMb: { type: Number, min: 1 },
    secretAliases: [{ type: String, trim: true }]
}, { _id: false });

const UserToolRunTimingSchema = new Schema<IUserToolRunTiming>({
    queuedAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    durationMs: { type: Number, min: 0, default: null }
}, { _id: false });

const UserToolRunResourceUsageSchema = new Schema<IUserToolRunResourceUsage>({
    peakMemoryMb: { type: Number, min: 0, default: null },
    cpuMs: { type: Number, min: 0, default: null },
    wallTimeMs: { type: Number, min: 0, default: null },
    memoryLimitMb: { type: Number, min: 0, default: null }
}, { _id: false });

const UserToolRunErrorSchema = new Schema<IUserToolRunError>({
    code: { type: String, trim: true, default: undefined },
    subsystem: {
        type: String,
        enum: ['runner', 'wrapper', 'user_code', 'dependency', 'sandbox_runtime', 'unknown', 'build_preparation', 'runtime_readiness', 'validation'],
        default: undefined
    },
    failureKind: { type: String, trim: true, default: undefined },
    message: { type: String, required: true },
    retryable: { type: Boolean, default: false }
}, { _id: false });

const UserToolRunSchema = new Schema<IUserToolRun>({
    executionId: {
        type: String,
        required: true,
        trim: true
    },
    ownerUserId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    toolId: {
        type: Schema.Types.ObjectId,
        ref: 'UserTool',
        required: true
    },
    toolVersionTag: {
        type: String,
        required: true,
        trim: true
    },
    toolContentHash: {
        type: String,
        required: true,
        trim: true
    },
    workflowId: {
        type: Schema.Types.ObjectId,
        ref: 'Workflow',
        default: null
    },
    agentPrototypeId: {
        type: Schema.Types.ObjectId,
        ref: 'AgentPrototype',
        default: null
    },
    agentInstanceId: {
        type: Schema.Types.ObjectId,
        ref: 'AgentInstance',
        default: null
    },
    launchContext: {
        type: String,
        required: true,
        enum: ['editor_test', 'workflow_run', 'system_validation']
    },
    status: {
        type: String,
        required: true,
        enum: ['queued', 'running', 'completed', 'failed', 'stopped', 'timed_out'],
        default: 'queued'
    },
    runtime: {
        type: String,
        required: true,
        enum: ['typescript', 'python']
    },
    runner: {
        type: String,
        required: true,
        enum: ['docker_sandbox', 'docker_rootless', 'firecracker'],
        default: 'docker_sandbox'
    },
    inputs: {
        type: Schema.Types.Mixed,
        required: true,
        default: () => ({})
    },
    outputs: {
        type: UserToolRunOutputsSchema,
        default: null
    },
    policySnapshot: {
        type: UserToolRunPolicySnapshotSchema,
        required: true
    },
    timing: {
        type: UserToolRunTimingSchema,
        required: true,
        default: () => ({ queuedAt: null, startedAt: null, finishedAt: null, durationMs: null })
    },
    resourceUsage: {
        type: UserToolRunResourceUsageSchema,
        default: undefined
    },
    error: {
        type: UserToolRunErrorSchema,
        default: null
    }
}, {
    timestamps: true,
    collection: 'user_tool_runs'
});

UserToolRunSchema.index(
    { executionId: 1 },
    { unique: true, name: 'uq_user_tool_runs_execution_id' }
);

UserToolRunSchema.index(
    { ownerUserId: 1, createdAt: -1 },
    { name: 'idx_user_tool_runs_owner_created' }
);

UserToolRunSchema.index(
    { ownerUserId: 1, workflowId: 1, createdAt: -1 },
    {
        partialFilterExpression: { workflowId: { $type: 'objectId' } },
        name: 'idx_user_tool_runs_owner_workflow_created'
    }
);

UserToolRunSchema.index(
    { toolId: 1, createdAt: -1 },
    { name: 'idx_user_tool_runs_tool_created' }
);

UserToolRunSchema.index(
    { ownerUserId: 1, status: 1, updatedAt: -1 },
    {
        partialFilterExpression: {
            status: { $in: ['queued', 'running'] }
        },
        name: 'idx_user_tool_runs_active_watchdog'
    }
);

export const UserToolRun = mongoose.model<IUserToolRun>('UserToolRun', UserToolRunSchema);
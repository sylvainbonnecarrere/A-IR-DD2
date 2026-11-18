import mongoose, { Document, Schema } from 'mongoose';
import {
    USER_TOOL_RUN_NETWORK_MODE_VALUES,
    USER_TOOL_RUN_RUNNER_VALUES,
    USER_TOOL_RUN_RUNTIME_VALUES,
    USER_TOOL_RUN_STATUS_VALUES,
} from '../domain/execution/userToolRun.contract';
import { RECONSTRUCTION_REJECTION_CODES, type RunReconstructionRejectionCode } from '../domain/execution/runReconstructionQuarantine';

export type UserToolRunLaunchContext = 'editor_test' | 'workflow_run' | 'system_validation';
export type UserToolRunStatus = (typeof USER_TOOL_RUN_STATUS_VALUES)[number];
export type UserToolRunRuntime = (typeof USER_TOOL_RUN_RUNTIME_VALUES)[number];
export type UserToolRunRunner = (typeof USER_TOOL_RUN_RUNNER_VALUES)[number];
export type UserToolRunNetworkMode = (typeof USER_TOOL_RUN_NETWORK_MODE_VALUES)[number];
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

export interface IUserToolRunLease {
    owner: string;
    token: string;
    acquiredAt: Date;
    expiresAt: Date;
}

export interface IUserToolRunSupervisedAttempt {
    attemptId: string;
    leaseOwner: string;
    leaseTokenDigest: string;
    createdAt: Date;
    dockerJournal?: {
        admission: 'open' | 'closed';
        pending: { id: string; kind: string } | null;
        lastOutcome: { operation: { id: string; kind: string }; outcome: 'response_observed' | 'unknown' } | null;
        hasUnknownOutcome: boolean;
    };
    workerLossReconciliation?: {
        containerName: string;
        containerState: 'absent' | 'created' | 'exited' | 'dead';
        verifiedAt: Date;
        workspaceLockReleased: boolean;
    };
}

export interface IUserToolRunReconstructionQuarantineResolution {
    code: RunReconstructionRejectionCode;
    quarantinedAt: Date;
    resolution: 'failed';
    resolvedAt: Date;
    resolvedBy: mongoose.Types.ObjectId;
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
    retryOfExecutionId?: string | null;
    requestFingerprint?: string | null;
    targetFingerprint?: string | null;
    privateContextCiphertext?: string | null;
    cancellationRequestedAt?: Date | null;
    cancellationRequestedBy?: mongoose.Types.ObjectId | null;
    lease?: IUserToolRunLease | null;
    reconstructionQuarantine?: { code: RunReconstructionRejectionCode; quarantinedAt: Date } | null;
    reconstructionQuarantineResolution?: IUserToolRunReconstructionQuarantineResolution | null;
    workspaceRetentionProtected?: boolean;
    supervisedAttempt?: IUserToolRunSupervisedAttempt | null;
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

const UserToolRunReconstructionQuarantineResolutionSchema = new Schema<IUserToolRunReconstructionQuarantineResolution>({
    code: { type: String, enum: RECONSTRUCTION_REJECTION_CODES, required: true },
    quarantinedAt: { type: Date, required: true },
    resolution: { type: String, enum: ['failed'], required: true },
    resolvedAt: { type: Date, required: true },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { _id: false });

const UserToolRunPolicySnapshotSchema = new Schema<IUserToolRunPolicySnapshot>({
    networkMode: {
        type: String,
        required: true,
        enum: [...USER_TOOL_RUN_NETWORK_MODE_VALUES]
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

const UserToolRunLeaseSchema = new Schema<IUserToolRunLease>({
    owner: { type: String, required: true },
    token: { type: String, required: true, select: false },
    acquiredAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
}, { _id: false });

const DockerJournalOperationSchema = new Schema({
    id: { type: String, required: true },
    kind: { type: String, enum: ['create', 'start', 'stop', 'kill', 'remove', 'inspect'], required: true },
}, { _id: false });

const DockerJournalOutcomeSchema = new Schema({
    operation: { type: DockerJournalOperationSchema, required: true },
    outcome: { type: String, enum: ['response_observed', 'unknown'], required: true },
}, { _id: false });

const WorkerLossReconciliationSchema = new Schema({
    containerName: { type: String, required: true },
    containerState: { type: String, enum: ['absent', 'created', 'exited', 'dead'], required: true },
    verifiedAt: { type: Date, required: true },
    workspaceLockReleased: { type: Boolean, required: true },
}, { _id: false });

const UserToolRunSupervisedAttemptSchema = new Schema<IUserToolRunSupervisedAttempt>({
    attemptId: { type: String, required: true },
    leaseOwner: { type: String, required: true },
    leaseTokenDigest: { type: String, required: true },
    createdAt: { type: Date, required: true },
    dockerJournal: {
        type: new Schema({
            admission: { type: String, enum: ['open', 'closed'], required: true },
            pending: { type: DockerJournalOperationSchema, default: null },
            lastOutcome: { type: DockerJournalOutcomeSchema, default: null },
            hasUnknownOutcome: { type: Boolean, required: true },
        }, { _id: false }),
        default: undefined,
    },
    workerLossReconciliation: {
        type: WorkerLossReconciliationSchema,
        default: undefined,
    },
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
    retryOfExecutionId: {
        type: String,
        trim: true,
        default: null
    },
    requestFingerprint: {
        type: String,
        trim: true,
        default: null
    },
    targetFingerprint: {
        type: String,
        trim: true,
        default: null
    },
    privateContextCiphertext: {
        type: String,
        select: false,
        default: null
    },
    cancellationRequestedAt: {
        type: Date,
        default: null
    },
    cancellationRequestedBy: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    lease: {
        type: UserToolRunLeaseSchema,
        default: null
    },
    reconstructionQuarantine: {
        type: new Schema({
            code: { type: String, enum: RECONSTRUCTION_REJECTION_CODES, required: true },
            quarantinedAt: { type: Date, required: true },
        }, { _id: false }),
        default: null,
    },
    reconstructionQuarantineResolution: {
        type: UserToolRunReconstructionQuarantineResolutionSchema,
        default: null,
    },
    workspaceRetentionProtected: {
        type: Boolean,
        select: false,
        default: false,
    },
    supervisedAttempt: {
        type: UserToolRunSupervisedAttemptSchema,
        select: false,
        default: null,
    },
    launchContext: {
        type: String,
        required: true,
        enum: ['editor_test', 'workflow_run', 'system_validation']
    },
    status: {
        type: String,
        required: true,
        enum: [...USER_TOOL_RUN_STATUS_VALUES],
        default: 'queued'
    },
    runtime: {
        type: String,
        required: true,
        enum: [...USER_TOOL_RUN_RUNTIME_VALUES]
    },
    runner: {
        type: String,
        required: true,
        enum: [...USER_TOOL_RUN_RUNNER_VALUES],
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

UserToolRunSchema.index(
    { status: 1, 'timing.queuedAt': 1 },
    {
        partialFilterExpression: { status: 'queued' },
        name: 'idx_user_tool_runs_queued_dispatch'
    }
);

UserToolRunSchema.index(
    { status: 1, 'lease.expiresAt': 1 },
    {
        partialFilterExpression: { status: 'running', 'lease.expiresAt': { $type: 'date' } },
        name: 'idx_user_tool_runs_running_lease_expiry'
    }
);

UserToolRunSchema.index(
    { status: 1, cancellationRequestedAt: 1 },
    {
        partialFilterExpression: { status: 'running', cancellationRequestedAt: { $type: 'date' } },
        name: 'idx_user_tool_runs_cancellation_requests'
    }
);

UserToolRunSchema.index(
    { ownerUserId: 1, retryOfExecutionId: 1, createdAt: 1 },
    {
        partialFilterExpression: { retryOfExecutionId: { $type: 'string' } },
        name: 'idx_user_tool_runs_retry_lineage'
    }
);

export const UserToolRun = mongoose.model<IUserToolRun>('UserToolRun', UserToolRunSchema);
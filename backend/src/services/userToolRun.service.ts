import mongoose from 'mongoose';
import {
    IUserToolRun,
    IUserToolRunError,
    IUserToolRunOutputs,
    IUserToolRunPolicySnapshot,
    IUserToolRunResourceUsage,
    UserToolRun,
    UserToolRunLaunchContext,
    UserToolRunRunner,
    UserToolRunRuntime,
    UserToolRunStatus
} from '../models';

type ObjectIdLike = mongoose.Types.ObjectId | string | null | undefined;

const ALLOWED_STATUS_TRANSITIONS: Record<UserToolRunStatus, UserToolRunStatus[]> = {
    queued: ['running', 'failed', 'stopped', 'timed_out'],
    running: ['completed', 'failed', 'stopped', 'timed_out'],
    completed: [],
    failed: [],
    stopped: [],
    timed_out: []
};

export interface CreateUserToolRunData {
    executionId: string;
    ownerUserId: ObjectIdLike;
    toolId: ObjectIdLike;
    toolVersionTag: string;
    toolContentHash: string;
    launchContext: UserToolRunLaunchContext;
    runtime: UserToolRunRuntime;
    runner?: UserToolRunRunner;
    inputs?: Record<string, unknown>;
    policySnapshot: IUserToolRunPolicySnapshot;
    workflowId?: ObjectIdLike;
    agentPrototypeId?: ObjectIdLike;
    agentInstanceId?: ObjectIdLike;
    queuedAt?: Date;
}

export interface CompleteUserToolRunData {
    outputs?: IUserToolRunOutputs | null;
    resourceUsage?: IUserToolRunResourceUsage;
    finishedAt?: Date;
}

export interface FailUserToolRunData {
    error: IUserToolRunError;
    outputs?: IUserToolRunOutputs | null;
    resourceUsage?: IUserToolRunResourceUsage;
    finishedAt?: Date;
}

export interface StopUserToolRunData {
    error?: IUserToolRunError | null;
    outputs?: IUserToolRunOutputs | null;
    resourceUsage?: IUserToolRunResourceUsage;
    finishedAt?: Date;
}

export interface ListUserToolRunsFilter {
    ownerUserId?: ObjectIdLike;
    workflowId?: ObjectIdLike;
    toolId?: ObjectIdLike;
    agentInstanceId?: ObjectIdLike;
    statuses?: UserToolRunStatus[];
    limit?: number;
}

export class UserToolRunStateError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'UserToolRunStateError';
    }
}

function toObjectId(value: ObjectIdLike, fieldName: string): mongoose.Types.ObjectId {
    if (!value) {
        throw new Error(`${fieldName} is required`);
    }

    if (value instanceof mongoose.Types.ObjectId) {
        return value;
    }

    if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error(`${fieldName} must be a valid ObjectId`);
    }

    return new mongoose.Types.ObjectId(value);
}

function toOptionalObjectId(value: ObjectIdLike): mongoose.Types.ObjectId | null {
    if (!value) {
        return null;
    }

    if (value instanceof mongoose.Types.ObjectId) {
        return value;
    }

    if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('Optional ObjectId value must be a valid ObjectId');
    }

    return new mongoose.Types.ObjectId(value);
}

function computeDurationMs(startedAt?: Date | null, finishedAt?: Date | null): number | null {
    if (!startedAt || !finishedAt) {
        return null;
    }

    const duration = finishedAt.getTime() - startedAt.getTime();
    return duration >= 0 ? duration : 0;
}

export class UserToolRunService {
    async createQueuedRun(data: CreateUserToolRunData): Promise<IUserToolRun> {
        if (!data.executionId?.trim()) {
            throw new Error('executionId is required');
        }

        const queuedAt = data.queuedAt ?? new Date();

        const run = new UserToolRun({
            executionId: data.executionId.trim(),
            ownerUserId: toObjectId(data.ownerUserId, 'ownerUserId'),
            toolId: toObjectId(data.toolId, 'toolId'),
            toolVersionTag: data.toolVersionTag,
            toolContentHash: data.toolContentHash,
            workflowId: toOptionalObjectId(data.workflowId),
            agentPrototypeId: toOptionalObjectId(data.agentPrototypeId),
            agentInstanceId: toOptionalObjectId(data.agentInstanceId),
            launchContext: data.launchContext,
            status: 'queued',
            runtime: data.runtime,
            runner: data.runner ?? 'docker_sandbox',
            inputs: data.inputs ?? {},
            outputs: null,
            policySnapshot: data.policySnapshot,
            timing: {
                queuedAt,
                startedAt: null,
                finishedAt: null,
                durationMs: null
            },
            error: null
        });

        await run.save();
        return run;
    }

    async createAndStartRun(
        data: CreateUserToolRunData,
        startedAt: Date = new Date()
    ): Promise<IUserToolRun> {
        await this.createQueuedRun(data);
        return this.markRunning(data.executionId, startedAt);
    }

    async markRunning(executionId: string, startedAt: Date = new Date()): Promise<IUserToolRun> {
        return this.transitionTo(executionId, 'running', {
            timing: {
                startedAt,
                finishedAt: null,
                durationMs: null
            },
            error: null
        });
    }

    async completeRun(executionId: string, data: CompleteUserToolRunData = {}): Promise<IUserToolRun> {
        const finishedAt = data.finishedAt ?? new Date();
        const run = await this.getRequiredRun(executionId);
        this.assertTransitionAllowed(run.status, 'completed', executionId);

        run.status = 'completed';
        run.outputs = data.outputs ?? run.outputs ?? null;
        run.error = null;
        run.resourceUsage = data.resourceUsage ?? run.resourceUsage;
        run.timing.finishedAt = finishedAt;
        run.timing.durationMs = computeDurationMs(run.timing.startedAt ?? null, finishedAt);
        await run.save();
        return run;
    }

    async failRun(executionId: string, data: FailUserToolRunData): Promise<IUserToolRun> {
        const finishedAt = data.finishedAt ?? new Date();
        const run = await this.getRequiredRun(executionId);
        this.assertTransitionAllowed(run.status, 'failed', executionId);

        run.status = 'failed';
        run.error = data.error;
        run.outputs = data.outputs ?? run.outputs ?? null;
        run.resourceUsage = data.resourceUsage ?? run.resourceUsage;
        run.timing.finishedAt = finishedAt;
        run.timing.durationMs = computeDurationMs(run.timing.startedAt ?? null, finishedAt);
        await run.save();
        return run;
    }

    async timeoutRun(executionId: string, data: StopUserToolRunData = {}): Promise<IUserToolRun> {
        return this.finishWithTerminalStatus(executionId, 'timed_out', data);
    }

    async stopRun(executionId: string, data: StopUserToolRunData = {}): Promise<IUserToolRun> {
        return this.finishWithTerminalStatus(executionId, 'stopped', data);
    }

    async getRunByExecutionId(executionId: string): Promise<IUserToolRun | null> {
        return UserToolRun.findOne({ executionId });
    }

    async listRuns(filter: ListUserToolRunsFilter = {}): Promise<IUserToolRun[]> {
        const query: Record<string, unknown> = {};

        if (filter.ownerUserId) {
            query.ownerUserId = toObjectId(filter.ownerUserId, 'ownerUserId');
        }

        if (filter.workflowId) {
            query.workflowId = toObjectId(filter.workflowId, 'workflowId');
        }

        if (filter.toolId) {
            query.toolId = toObjectId(filter.toolId, 'toolId');
        }

        if (filter.agentInstanceId) {
            query.agentInstanceId = toObjectId(filter.agentInstanceId, 'agentInstanceId');
        }

        if (filter.statuses && filter.statuses.length > 0) {
            query.status = { $in: filter.statuses };
        }

        return UserToolRun.find(query)
            .sort({ createdAt: -1 })
            .limit(filter.limit ?? 50);
    }

    async listActiveRunsForUser(ownerUserId: ObjectIdLike): Promise<IUserToolRun[]> {
        return this.listRuns({
            ownerUserId,
            statuses: ['queued', 'running'],
            limit: 100
        });
    }

    private async finishWithTerminalStatus(
        executionId: string,
        status: Extract<UserToolRunStatus, 'stopped' | 'timed_out'>,
        data: StopUserToolRunData
    ): Promise<IUserToolRun> {
        const finishedAt = data.finishedAt ?? new Date();
        const run = await this.getRequiredRun(executionId);
        this.assertTransitionAllowed(run.status, status, executionId);

        run.status = status;
        run.error = data.error ?? run.error ?? null;
        run.outputs = data.outputs ?? run.outputs ?? null;
        run.resourceUsage = data.resourceUsage ?? run.resourceUsage;
        run.timing.finishedAt = finishedAt;
        run.timing.durationMs = computeDurationMs(run.timing.startedAt ?? null, finishedAt);
        await run.save();
        return run;
    }

    private async transitionTo(
        executionId: string,
        nextStatus: Extract<UserToolRunStatus, 'running'>,
        patch: {
            timing?: Partial<IUserToolRun['timing']>;
            error?: IUserToolRunError | null;
        }
    ): Promise<IUserToolRun> {
        const run = await this.getRequiredRun(executionId);
        this.assertTransitionAllowed(run.status, nextStatus, executionId);

        run.status = nextStatus;
        if (patch.timing) {
            run.timing = {
                ...run.timing,
                ...patch.timing
            };
        }
        if (patch.error !== undefined) {
            run.error = patch.error;
        }
        await run.save();
        return run;
    }

    private async getRequiredRun(executionId: string): Promise<IUserToolRun> {
        const run = await this.getRunByExecutionId(executionId);
        if (!run) {
            throw new Error(`UserToolRun not found for executionId '${executionId}'`);
        }
        return run;
    }

    private assertTransitionAllowed(
        currentStatus: UserToolRunStatus,
        nextStatus: UserToolRunStatus,
        executionId: string
    ): void {
        if (!ALLOWED_STATUS_TRANSITIONS[currentStatus].includes(nextStatus)) {
            throw new UserToolRunStateError(
                `Invalid UserToolRun transition for ${executionId}: ${currentStatus} -> ${nextStatus}`
            );
        }
    }
}
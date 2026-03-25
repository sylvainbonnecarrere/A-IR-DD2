import type { ChatMessage, ToolCallRecord } from '../types';
import type { FunctionRunRecord } from '../types/function.types';
import { toolRepository } from './toolRepository';

const BOS_RUN_CACHE_TTL_MS = 2_000;

interface BosRunCacheEntry {
    value: FunctionRunRecord | null;
    expiresAt: number;
    pending?: Promise<FunctionRunRecord | null>;
}

const bosRunCache = new Map<string, BosRunCacheEntry>();

export interface BosHydratedToolCallRecord extends ToolCallRecord {
    toolId?: string;
    persistedRunStatus?: FunctionRunRecord['status'];
    persistedRunUpdatedAt?: string;
}

function pruneExpiredBosRunCache(now: number): void {
    for (const [cacheKey, entry] of bosRunCache.entries()) {
        if (!entry.pending && entry.expiresAt <= now) {
            bosRunCache.delete(cacheKey);
        }
    }
}

async function loadRunByExecutionIdWithCache(executionId: string, toolId: string): Promise<FunctionRunRecord | null> {
    const cacheKey = `${toolId}:${executionId}`;
    const now = Date.now();
    pruneExpiredBosRunCache(now);

    const existingEntry = bosRunCache.get(cacheKey);
    if (existingEntry && now < existingEntry.expiresAt) {
        if (existingEntry.pending) {
            return existingEntry.pending;
        }

        return existingEntry.value;
    }

    const pending = toolRepository.loadFunctionRunByExecutionId(executionId, toolId)
        .then((response) => response.data)
        .catch(() => null)
        .then((value) => {
            bosRunCache.set(cacheKey, {
                value,
                expiresAt: Date.now() + BOS_RUN_CACHE_TTL_MS,
            });
            return value;
        });

    bosRunCache.set(cacheKey, {
        value: existingEntry?.value ?? null,
        expiresAt: now + BOS_RUN_CACHE_TTL_MS,
        pending,
    });

    return pending;
}

function mergeToolCallRecordWithRun(
    record: ToolCallRecord,
    matchingRun?: FunctionRunRecord
): BosHydratedToolCallRecord {
    const resolvedToolId = record.toolId || record.functionId || undefined;

    if (!matchingRun) {
        return {
            ...record,
            toolId: resolvedToolId,
        };
    }

    return {
        ...record,
        toolId: resolvedToolId,
        durationMs: record.durationMs || matchingRun.timing.durationMs || undefined,
        artifacts: (record.artifacts && record.artifacts.length > 0)
            ? record.artifacts
            : matchingRun.outputs?.artifacts,
        persistedRunStatus: matchingRun.status,
        persistedRunUpdatedAt: matchingRun.updatedAt,
    };
}

function hasRecordChanged(before: ToolCallRecord, after: BosHydratedToolCallRecord): boolean {
    return JSON.stringify(before.artifacts ?? []) !== JSON.stringify(after.artifacts ?? [])
        || before.durationMs !== after.durationMs
        || before.functionId !== after.functionId
        || before.executionId !== after.executionId
    || (before.toolId ?? null) !== (after.toolId ?? null)
    || (before.persistedRunStatus ?? null) !== (after.persistedRunStatus ?? null)
    || (before.persistedRunUpdatedAt ?? null) !== (after.persistedRunUpdatedAt ?? null);
}

function serializeArtifacts(artifacts?: ToolCallRecord['artifacts']): string {
    return JSON.stringify(artifacts ?? []);
}

export function buildBosHydrationFingerprint(messages: ChatMessage[]): string {
    return messages
        .filter(
            (message) => message.sender === 'tool' && (message.toolCallRecord?.toolId || message.toolCallRecord?.functionId) && message.toolCallRecord.executionId
        )
        .map((message) => {
            const record = message.toolCallRecord!;
            const resolvedToolId = record.toolId || record.functionId || '';
            return [
                message.id,
                resolvedToolId,
                record.executionId,
                record.durationMs ?? '',
                record.persistedRunStatus ?? '',
                record.persistedRunUpdatedAt ?? '',
                serializeArtifacts(record.artifacts)
            ].join('|');
        })
        .join('||');
}

export function resetBosRunHydrationCache(): void {
    bosRunCache.clear();
}

export async function hydrateToolMessagesFromPersistedRuns(messages: ChatMessage[]): Promise<ChatMessage[]> {
    const toolMessages = messages.filter(
        (message) => message.sender === 'tool' && (message.toolCallRecord?.toolId || message.toolCallRecord?.functionId) && message.toolCallRecord.executionId
    );

    if (toolMessages.length === 0) {
        return messages;
    }

    const runsByExecutionId = new Map<string, FunctionRunRecord>();

    await Promise.all(toolMessages.map(async (message) => {
        const toolId = message.toolCallRecord!.toolId || message.toolCallRecord!.functionId;
        const executionId = message.toolCallRecord!.executionId;
        const cacheKey = `${toolId}:${executionId}`;

        if (!toolId || !executionId || runsByExecutionId.has(cacheKey)) {
            return;
        }

        const run = await loadRunByExecutionIdWithCache(executionId, toolId);
        if (run) {
            runsByExecutionId.set(cacheKey, run);
        }
    }));

    let hasAnyChange = false;
    const projectedMessages = messages.map((message) => {
        const resolvedToolId = message.toolCallRecord?.toolId || message.toolCallRecord?.functionId;
        if (message.sender !== 'tool' || !resolvedToolId || !message.toolCallRecord.executionId) {
            return message;
        }

        const matchingRun = runsByExecutionId.get(`${resolvedToolId}:${message.toolCallRecord.executionId}`);
        const projectedRecord = mergeToolCallRecordWithRun(message.toolCallRecord, matchingRun);
        if (!hasRecordChanged(message.toolCallRecord, projectedRecord)) {
            return message;
        }

        hasAnyChange = true;
        return {
            ...message,
            toolCallRecord: projectedRecord,
        };
    });

    return hasAnyChange ? projectedMessages : messages;
}
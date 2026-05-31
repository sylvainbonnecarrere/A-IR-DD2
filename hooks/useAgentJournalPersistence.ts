import { useCallback, useRef } from 'react';
import { useJournalQueue } from './useJournalQueue';

type JournalEntryType = 'chat' | 'error' | 'media' | 'tool_invocation';

interface UseAgentJournalPersistenceOptions {
    workflowId?: string | null;
    instanceId?: string | null;
}

interface ToolInvocationPersistencePayload {
    toolCallId: string;
    toolName: string;
    phase: 'started' | 'completed' | 'failed';
    executionId?: string;
    toolId?: string;
    functionId?: string;
}

export const useAgentJournalPersistence = ({
    workflowId,
    instanceId,
}: UseAgentJournalPersistenceOptions) => {
    const { enqueueEntry } = useJournalQueue();
    const emittedToolInvocationPhasesRef = useRef<Record<string, true>>({});

    const persistJournalEntry = useCallback((entryType: JournalEntryType, payload: Record<string, unknown>) => {
        if (!workflowId || !instanceId) {
            console.warn('[Journal] Missing context for persistence:', {
                workflowId,
                instanceId,
                entryType,
            });
            return false;
        }

        enqueueEntry(workflowId, instanceId, entryType, payload);
        return true;
    }, [enqueueEntry, instanceId, workflowId]);

    const persistToolInvocation = useCallback((payload: ToolInvocationPersistencePayload) => {
        const phaseKey = `${payload.toolCallId}:${payload.phase}`;
        if (emittedToolInvocationPhasesRef.current[phaseKey]) {
            return false;
        }

        emittedToolInvocationPhasesRef.current[phaseKey] = true;

        return persistJournalEntry('tool_invocation', {
            messageId: `toolinv:${payload.toolCallId}:${payload.phase}`,
            toolCallId: payload.toolCallId,
            toolName: payload.toolName,
            phase: payload.phase,
            ...(payload.executionId ? { executionId: payload.executionId } : {}),
            ...(payload.toolId ? { toolId: payload.toolId } : {}),
            ...(payload.functionId ? { functionId: payload.functionId } : {}),
        });
    }, [persistJournalEntry]);

    const resetToolInvocationDedup = useCallback(() => {
        emittedToolInvocationPhasesRef.current = {};
    }, []);

    return {
        persistJournalEntry,
        persistToolInvocation,
        resetToolInvocationDedup,
    };
};
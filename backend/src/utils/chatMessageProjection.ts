function buildToolInvocationMessage(entry: any, matchingRun?: any) {
    const payload = entry.payload || {};
    const phase = payload.phase;
    const isFailure = phase === 'failed';
    const persistedRunStatus = matchingRun?.status || (phase === 'started' ? 'running' : undefined);

    return {
        id: `toolinv:${payload.toolCallId}`,
        sender: 'tool',
        text: payload.toolName || '',
        timestamp: entry.timestamp,
        toolCallRecord: {
            id: payload.toolCallId,
            toolId: payload.toolId,
            functionId: payload.functionId,
            functionName: payload.toolName,
            arguments: matchingRun?.inputs || {},
            result: matchingRun?.outputs?.result || (isFailure ? { error: 'Tool execution failed' } : {}),
            status: isFailure ? 'error' : 'success',
            durationMs: matchingRun?.timing?.durationMs ?? undefined,
            executionId: payload.executionId,
            runner: matchingRun?.runner,
            artifacts: matchingRun?.outputs?.artifacts || [],
            persistedRunStatus,
            persistedRunUpdatedAt: matchingRun?.updatedAt ? new Date(matchingRun.updatedAt).toISOString() : undefined,
            timestamp: entry.timestamp,
        }
    };
}

function buildChatMessage(entry: any) {
    const payload = entry.payload || {};
    const persistedMessageId = typeof payload.messageId === 'string' && payload.messageId.trim().length > 0
        ? payload.messageId
        : typeof entry._id?.toString === 'function'
            ? entry._id.toString()
            : undefined;

    const role = payload.role === 'assistant'
        ? 'agent'
        : payload.role === 'tool'
            ? 'tool'
            : payload.role === 'tool_result'
                ? 'tool_result'
                : payload.role === 'user'
                    ? 'user'
                    : 'agent';

    return {
        ...(persistedMessageId ? { id: persistedMessageId } : {}),
        sender: role,
        text: payload.content || '',
        timestamp: entry.timestamp,
        image: payload.imageBase64,
        mimeType: payload.mimeType,
        fileName: payload.fileName,
        llmProvider: payload.llmProvider,
        modelUsed: payload.modelUsed,
        tokensUsed: payload.tokensUsed,
        toolCalls: payload.toolCalls,
        toolCallId: payload.toolCallId,
        toolName: payload.toolName,
        status: payload.status,
        isError: payload.isError,
        toolCallRecord: payload.toolCallRecord,
    };
}

export function buildChatMessagesByInstance(entries: any[], toolRunsByExecutionId: Map<string, any>) {
    const journalByInstance: Record<string, any[]> = {};
    const toolInvocationIndexByInstance = new Map<string, Map<string, number>>();

    for (const entry of entries) {
        const instanceId = entry.agentInstanceId?.toString() || '';
        if (!journalByInstance[instanceId]) {
            journalByInstance[instanceId] = [];
        }

        if (!toolInvocationIndexByInstance.has(instanceId)) {
            toolInvocationIndexByInstance.set(instanceId, new Map());
        }

        if (entry.type === 'tool_invocation') {
            const toolCallId = entry.payload?.toolCallId;
            if (typeof toolCallId !== 'string' || !toolCallId.trim()) {
                continue;
            }

            const projectedMessage = buildToolInvocationMessage(
                entry,
                entry.payload?.executionId ? toolRunsByExecutionId.get(entry.payload.executionId) : undefined
            );

            const toolInvocationIndex = toolInvocationIndexByInstance.get(instanceId)!;
            const existingIndex = toolInvocationIndex.get(toolCallId);
            if (typeof existingIndex === 'number') {
                journalByInstance[instanceId][existingIndex] = projectedMessage;
            } else {
                toolInvocationIndex.set(toolCallId, journalByInstance[instanceId].length);
                journalByInstance[instanceId].push(projectedMessage);
            }

            continue;
        }

        journalByInstance[instanceId].push(buildChatMessage(entry));
    }

    return journalByInstance;
}
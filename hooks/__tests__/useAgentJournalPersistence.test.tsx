import React from 'react';
import { act, render } from '@testing-library/react';
import { useAgentJournalPersistence } from '../useAgentJournalPersistence';

const mockEnqueueEntry = jest.fn();

jest.mock('../useJournalQueue', () => ({
    useJournalQueue: () => ({ enqueueEntry: mockEnqueueEntry })
}));

describe('useAgentJournalPersistence', () => {
    let latestResult: ReturnType<typeof useAgentJournalPersistence> | null = null;

    function HookProbe(props: { workflowId?: string | null; instanceId?: string | null }) {
        latestResult = useAgentJournalPersistence(props);
        return null;
    }

    beforeEach(() => {
        latestResult = null;
        jest.clearAllMocks();
    });

    it('deduplicates tool invocation phases and emits canonical payload metadata', () => {
        render(<HookProbe workflowId="workflow-1" instanceId="instance-1" />);

        act(() => {
            latestResult?.persistToolInvocation({
                toolCallId: 'call-1',
                toolName: 'weather_tool',
                phase: 'started',
                toolId: 'tool.weather',
                functionId: 'legacy-weather',
            });
        });

        act(() => {
            latestResult?.persistToolInvocation({
                toolCallId: 'call-1',
                toolName: 'weather_tool',
                phase: 'started',
                toolId: 'tool.weather',
                functionId: 'legacy-weather',
            });
        });

        expect(mockEnqueueEntry).toHaveBeenCalledTimes(1);
        expect(mockEnqueueEntry).toHaveBeenCalledWith(
            'workflow-1',
            'instance-1',
            'tool_invocation',
            expect.objectContaining({
                messageId: 'toolinv:call-1:started',
                toolCallId: 'call-1',
                toolName: 'weather_tool',
                phase: 'started',
                toolId: 'tool.weather',
                functionId: 'legacy-weather',
            })
        );
    });

    it('resets the tool invocation dedup cache between interactions', () => {
        render(<HookProbe workflowId="workflow-1" instanceId="instance-1" />);

        act(() => {
            latestResult?.persistToolInvocation({
                toolCallId: 'call-2',
                toolName: 'web_search_py',
                phase: 'completed',
                executionId: 'exec-2',
            });
        });

        act(() => {
            latestResult?.resetToolInvocationDedup();
        });

        act(() => {
            latestResult?.persistToolInvocation({
                toolCallId: 'call-2',
                toolName: 'web_search_py',
                phase: 'completed',
                executionId: 'exec-2',
            });
        });

        expect(mockEnqueueEntry).toHaveBeenCalledTimes(2);
    });
});
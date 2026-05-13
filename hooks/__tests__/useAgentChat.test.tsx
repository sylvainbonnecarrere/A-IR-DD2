import React from 'react';
import { render } from '@testing-library/react';
import { LLMProvider, RobotId } from '../../types';

const mockUseAgentJournalPersistence = jest.fn(() => ({
    persistJournalEntry: jest.fn(),
    persistToolInvocation: jest.fn(),
    resetToolInvocationDedup: jest.fn(),
}));

jest.mock('../useAgentJournalPersistence', () => ({
    useAgentJournalPersistence: (args: unknown) => mockUseAgentJournalPersistence(args),
}));

jest.mock('../../services/llmService', () => ({
    generateContentStream: jest.fn(),
    generateContent: jest.fn(),
    generateContentWithWebSearchGrounding: jest.fn(),
}));

jest.mock('../../stores/useRuntimeStore', () => ({
    useRuntimeStore: jest.fn(() => ({
        getNodeMessages: jest.fn(() => []),
        addNodeMessage: jest.fn(),
        setNodeMessages: jest.fn(),
        setNodeExecuting: jest.fn(),
        localLLMProfiles: [],
    })),
}));

jest.mock('../../stores/useFunctionStore', () => ({
    useFunctionStore: jest.fn((selector?: (state: Record<string, unknown>) => unknown) => {
        const state = {
            functions: [],
            loadFunctions: jest.fn(),
        };
        return selector ? selector(state) : state;
    }),
}));

jest.mock('../../stores/useDesignStore', () => {
    const actual = jest.requireActual('../../stores/useDesignStore');

    return {
        ...actual,
        useDesignStore: jest.fn((selector?: (state: Record<string, unknown>) => unknown) => {
            const state = {
                agentInstances: [
                    {
                        id: 'instance-1',
                        workflowId: 'workflow-1',
                    }
                ],
            };
            return selector ? selector(state) : state;
        }),
    };
});

const { useAgentChat } = require('../useAgentChat');

describe('useAgentChat', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    function HookProbe() {
        useAgentChat({
            nodeId: 'node-1',
            agent: {
                id: 'agent-1',
                name: 'Fullscreen Agent',
                role: 'assistant',
                systemPrompt: 'Be precise',
                llmProvider: LLMProvider.OpenAI,
                model: 'gpt-4o-mini',
                capabilities: [],
                creator_id: RobotId.Archi,
                created_at: '2026-01-01T00:00:00.000Z',
                updated_at: '2026-01-01T00:00:00.000Z',
            },
            llmConfigs: [],
            t: (key: string) => key,
            instanceId: 'instance-1',
            isAuthenticated: true,
            accessToken: 'token-1',
        });

        return null;
    }

    it('derives workflowId before initializing journal persistence', () => {
        expect(() => render(<HookProbe />)).not.toThrow();
        expect(mockUseAgentJournalPersistence).toHaveBeenCalledWith({
            workflowId: 'workflow-1',
            instanceId: 'instance-1',
        });
    });
});
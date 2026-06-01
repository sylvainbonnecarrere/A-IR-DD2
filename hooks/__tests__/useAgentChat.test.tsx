import React from 'react';
import { render } from '@testing-library/react';
import { createTestAgent, createTestAgentInstance } from '../../tests/builders/domainBuilders';
import { resetUseAgentChatHarness } from '../../tests/harnesses/useAgentChatHarness';

const mockUseAgentJournalPersistence = jest.fn((_args?: unknown) => ({
    persistJournalEntry: jest.fn(),
    persistToolInvocation: jest.fn(),
    resetToolInvocationDedup: jest.fn(),
}));

let useAgentChatHarness = resetUseAgentChatHarness();

jest.mock('../useAgentJournalPersistence', () => ({
    useAgentJournalPersistence: (args: unknown) => mockUseAgentJournalPersistence(args),
}));

jest.mock('../../services/llmService', () => ({
    generateContentStream: jest.fn(),
    generateContent: jest.fn(),
    generateContentWithWebSearchGrounding: jest.fn(),
}));

jest.mock('../../stores/useRuntimeStore', () => ({
    useRuntimeStore: jest.fn((selector?: (state: Record<string, unknown>) => unknown) => {
        const { getUseAgentChatHarness } = require('../../tests/harnesses/useAgentChatHarness');
        const state = getUseAgentChatHarness().runtimeStore;
        return selector ? selector(state) : state;
    }),
}));

jest.mock('../../stores/useFunctionStore', () => ({
    useFunctionStore: Object.assign(jest.fn((selector?: (state: Record<string, unknown>) => unknown) => {
        const { getUseAgentChatHarness } = require('../../tests/harnesses/useAgentChatHarness');
        const state = getUseAgentChatHarness().functionStore;
        return selector ? selector(state) : state;
    }), {
        getState: () => {
            const { getUseAgentChatHarness } = require('../../tests/harnesses/useAgentChatHarness');
            return getUseAgentChatHarness().functionStore;
        },
    }),
}));

jest.mock('../../stores/useDesignStore', () => {
    const actual = jest.requireActual('../../stores/useDesignStore');

    return {
        ...actual,
        useDesignStore: jest.fn((selector?: (state: Record<string, unknown>) => unknown) => {
            const { getUseAgentChatHarness } = require('../../tests/harnesses/useAgentChatHarness');
            const state = getUseAgentChatHarness().designStore;
            return selector ? selector(state) : state;
        }),
    };
});

const { useAgentChat } = require('../useAgentChat');

describe('useAgentChat', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        useAgentChatHarness = resetUseAgentChatHarness({
            agent: createTestAgent({
                id: 'agent-1',
                name: 'Fullscreen Agent',
                role: 'assistant',
                systemPrompt: 'Be precise',
            }),
            agentInstance: createTestAgentInstance({
                id: 'instance-1',
                prototypeId: 'agent-1',
                workflowId: 'workflow-1',
            }),
        });
    });

    function HookProbe() {
        useAgentChat({
            nodeId: 'node-1',
            agent: useAgentChatHarness.agent,
            llmConfigs: [],
            t: (key: string) => key,
            instanceId: useAgentChatHarness.agentInstance.id,
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
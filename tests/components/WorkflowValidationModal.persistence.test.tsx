import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { WorkflowValidationModal } from '../../components/modals/WorkflowValidationModal';
import { LLMCapability, LLMProvider, type Agent, type LLMConfig } from '../../types';

jest.mock('../../hooks/useLocalization', () => ({
    useLocalization: () => ({
        t: (key: string) => key,
    }),
}));

jest.mock('../../contexts/LocalizationContext', () => ({
    useLocalization: () => ({
        t: (key: string) => key,
    }),
}));

jest.mock('../../hooks/useAuth', () => ({
    useAuth: () => ({
        user: { id: 'user-1', email: 'test@test.fr' },
        isAuthenticated: true,
        accessToken: 'token',
    }),
}));

jest.mock('../../hooks/useCloudConnectionProfiles', () => ({
    useCloudConnectionProfiles: () => ({
        profiles: [],
        loading: false,
        error: null,
        loadProfiles: jest.fn(),
        createProfile: jest.fn(),
        updateProfile: jest.fn(),
        deleteProfile: jest.fn(),
        testProfile: jest.fn(),
        clearError: jest.fn(),
    }),
}));

describe('WorkflowValidationModal persistence override', () => {
    const llmConfigs: LLMConfig[] = [
        {
            provider: LLMProvider.Gemini,
            enabled: true,
            apiKey: 'test-key',
            capabilities: {
                [LLMCapability.Chat]: true,
            },
        },
    ];

    const agent: Agent = {
        id: 'agent-1',
        name: 'Jiminy Banana',
        role: 'Assistant',
        systemPrompt: 'Aide l utilisateur.',
        llmProvider: LLMProvider.Gemini,
        model: 'gemini-2.0-flash',
        capabilities: [LLMCapability.Chat],
        tools: [],
        persistenceConfig: {
            saveChat: true,
            saveErrors: true,
            saveHistorySummary: false,
            saveLinks: false,
            saveTasks: false,
            saveMedia: false,
            mediaStorage: 'db',
            allowWorkspaceWrite: false,
        },
        creator_id: 'AR_001' as any,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
    };

    it('confirms a workspace media persistence override', () => {
        const onConfirm = jest.fn();

        render(
            <WorkflowValidationModal
                isOpen={true}
                agent={agent}
                llmConfigs={llmConfigs}
                onConfirm={onConfirm}
                onCancel={jest.fn()}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'config_tab_save' }));
        fireEvent.click(screen.getByRole('switch', { name: 'Sauvegarder les médias' }));
        fireEvent.click(screen.getByRole('button', { name: /Workspace/ }));
        fireEvent.click(screen.getByRole('button', { name: 'workflow_add_validation' }));

        expect(onConfirm).toHaveBeenCalledWith(
            'Jiminy Banana',
            expect.objectContaining({
                saveMedia: true,
                mediaStorage: 'workspace',
                allowWorkspaceWrite: true,
            })
        );
    });
});
import React from 'react';
import { render, screen } from '@testing-library/react';
import { AgentPersistenceForm } from '../../components/modals/AgentPersistenceForm';
import type { PersistenceConfig } from '../../types';

jest.mock('../../contexts/LocalizationContext', () => ({
    useLocalization: () => ({
        t: (key: string) => key,
    }),
}));

jest.mock('../../hooks/useAuth', () => ({
    useAuth: () => ({
        isAuthenticated: true,
    }),
}));

jest.mock('../../hooks/useCloudConnectionProfiles', () => ({
    useCloudConnectionProfiles: () => ({
        profiles: [
            {
                id: 'cloud-profile-1',
                displayName: 'Media S3',
                provider: 's3',
                enabled: true,
                hasSecretMaterial: true,
                target: {
                    bucketName: 'team-bucket',
                    region: 'eu-west-3',
                    endpoint: null,
                    forcePathStyle: false,
                    keyPrefix: 'workflow/'
                },
                status: {
                    state: 'configured',
                    lastValidatedAt: null,
                    lastErrorCode: null,
                    lastValidationMessage: null,
                },
                secretSummary: {
                    accessKeyIdMasked: '••••MPLE',
                    secretAccessKeyPresent: true,
                },
            }
        ],
        loading: false,
        error: null,
        loadProfiles: jest.fn().mockResolvedValue(undefined),
        createProfile: jest.fn(),
        updateProfile: jest.fn(),
        deleteProfile: jest.fn(),
        testProfile: jest.fn(),
        clearError: jest.fn(),
    }),
}));

describe('AgentPersistenceForm cloud profile selection', () => {
    test('cloud mode shows a profile selector instead of raw secret fields', () => {
        const config: PersistenceConfig = {
            saveChat: true,
            saveErrors: true,
            saveHistorySummary: false,
            saveLinks: false,
            saveTasks: false,
            saveMedia: true,
            mediaStorage: 'cloud',
            allowWorkspaceWrite: false,
        };

        render(
            React.createElement(AgentPersistenceForm, {
                config,
                onChange: jest.fn(),
                disabled: false,
            })
        );

        expect(screen.getByRole('combobox', { name: 'Profil cloud' })).toBeInTheDocument();
        expect(screen.getByText('Media S3')).toBeInTheDocument();
        expect(screen.queryByLabelText('Access Key ID')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Secret Access Key')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Clé de Service Account (JSON)')).not.toBeInTheDocument();
    });
});
import { normalizePersistenceConfig, sanitizePersistenceConfigForApi } from '../../types';

describe('normalizePersistenceConfig', () => {
    it('strips nullable cloud fields that would fail the backend instance update schema', () => {
        const normalized = normalizePersistenceConfig({
            saveMedia: true,
            mediaStorage: 'workspace',
            allowWorkspaceWrite: true,
            cloudConnectionProfileId: null as unknown as string,
            cloudStorageConfig: null as unknown as never,
        });

        expect(normalized).toEqual(expect.objectContaining({
            saveMedia: true,
            mediaStorage: 'workspace',
            allowWorkspaceWrite: true,
        }));
        expect(normalized.cloudConnectionProfileId).toBeUndefined();
        expect(normalized.cloudStorageConfig).toBeUndefined();
        expect(JSON.stringify(normalized)).not.toContain('cloudConnectionProfileId');
        expect(JSON.stringify(normalized)).not.toContain('cloudStorageConfig');
    });
});

describe('sanitizePersistenceConfigForApi', () => {
    it('removes frontend-only cloud config and nullable values before instance/prototype saves', () => {
        const sanitized = sanitizePersistenceConfigForApi({
            saveChat: true,
            saveChatHistory: true,
            saveErrors: true,
            saveHistorySummary: false,
            saveLinks: false,
            saveTasks: false,
            saveTaskExecution: false,
            saveMedia: true,
            mediaStorage: 'workspace',
            allowWorkspaceWrite: true,
            cloudConnectionProfileId: null as unknown as string,
            cloudStorageConfig: {
                provider: 's3',
            } as never,
            retentionDays: null as unknown as number,
        });

        expect(sanitized).toEqual({
            saveChat: true,
            saveChatHistory: true,
            saveErrors: true,
            saveHistorySummary: false,
            saveLinks: false,
            saveTasks: false,
            saveTaskExecution: false,
            saveMedia: true,
            mediaStorage: 'workspace',
            allowWorkspaceWrite: true,
        });
        expect(JSON.stringify(sanitized)).not.toContain('cloudConnectionProfileId');
        expect(JSON.stringify(sanitized)).not.toContain('cloudStorageConfig');
        expect(JSON.stringify(sanitized)).not.toContain('retentionDays');
    });
});
import mongoose from 'mongoose';
import { transformAgentInstanceForFrontend } from '../src/utils/transforms';

describe('Agent instance egress sanitizer', () => {
    it('removes raw cloudStorageConfig from persistenceConfig responses', () => {
        const transformed = transformAgentInstanceForFrontend({
            _id: new mongoose.Types.ObjectId(),
            name: 'Media Agent',
            role: 'assistant',
            llmProvider: 'openai',
            llmModel: 'gpt-4o-mini',
            systemPrompt: 'Generate media',
            capabilities: ['image'],
            toolSelections: [],
            historyConfig: {},
            outputConfig: {},
            position: { x: 0, y: 0 },
            persistenceConfig: {
                saveChat: true,
                saveErrors: true,
                saveHistorySummary: false,
                saveLinks: false,
                saveTasks: false,
                saveMedia: true,
                allowWorkspaceWrite: true,
                mediaStorage: 'local',
                cloudStorageConfig: {
                    provider: 's3',
                    bucket: 'secret-bucket',
                    credentials: {
                        accessKeyId: 'AKIA_TEST',
                        secretAccessKey: 'super-secret',
                    },
                },
            },
        } as any);

        expect(transformed.persistenceConfig).toMatchObject({
            saveMedia: true,
            allowWorkspaceWrite: true,
            mediaStorage: 'workspace',
        });
        expect(transformed.persistenceConfig).not.toHaveProperty('cloudStorageConfig');
    });
});
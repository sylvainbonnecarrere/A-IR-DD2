import { API_BASE_URL } from '../../config/api.config';
import {
    addAgentInstanceContent,
    createChatContent,
    createErrorContent,
    createImageContent,
} from '../../services/persistenceService';

describe('persistenceService journal convergence', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ success: true }),
        }) as unknown as typeof fetch;
    });

    afterEach(() => {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    it('posts chat content to the journal endpoint with canonical payload mapping', async () => {
        const timestamp = new Date('2026-05-19T10:15:00.000Z');

        await addAgentInstanceContent('instance-1', {
            ...createChatContent('tool', 'Hello from legacy helper', {
                llmProvider: 'OpenAI',
                modelUsed: 'gpt-4.1-mini',
                tokensUsed: 42,
            }),
            role: 'tool_result',
            timestamp,
            metadata: {
                llmProvider: 'OpenAI',
                modelUsed: 'gpt-4.1-mini',
                tokensUsed: 42,
                messageId: 'legacy-msg-1',
            }
        }, {
            isAuthenticated: true,
            accessToken: 'token-123',
        });

        expect(global.fetch).toHaveBeenCalledTimes(1);

        const [url, requestInit] = (global.fetch as jest.Mock).mock.calls[0];
        expect(url).toBe(`${API_BASE_URL}/api/agent-instances/instance-1/journal`);

        const payload = JSON.parse(requestInit.body as string);
        expect(payload).toEqual(expect.objectContaining({
            type: 'chat',
            timestamp: timestamp.toISOString(),
            payload: expect.objectContaining({
                role: 'tool_result',
                content: 'Hello from legacy helper',
                llmProvider: 'OpenAI',
                modelUsed: 'gpt-4.1-mini',
                tokensUsed: 42,
                messageId: 'legacy-msg-1',
            })
        }));
    });

    it('posts error content to the journal endpoint with explicit error severity', async () => {
        const timestamp = new Date('2026-05-19T10:45:00.000Z');

        await addAgentInstanceContent('instance-err', {
            ...createErrorContent('validation_error', 'Request failed validation', 'frontend', true, 2, 'VAL_400'),
            timestamp,
        }, {
            isAuthenticated: true,
            accessToken: 'token-123',
        });

        const [, requestInit] = (global.fetch as jest.Mock).mock.calls[0];
        const payload = JSON.parse(requestInit.body as string);

        expect(payload).toEqual(expect.objectContaining({
            type: 'error',
            severity: 'error',
            timestamp: timestamp.toISOString(),
            payload: expect.objectContaining({
                errorCode: 'VAL_400',
                message: 'Request failed validation',
                source: 'frontend',
                retryable: true,
                attempts: 2,
            })
        }));
    });

    it('maps image content to canonical media journal payloads', async () => {
        const timestamp = new Date('2026-05-19T11:00:00.000Z');

        await addAgentInstanceContent('instance-media', {
            ...createImageContent('media-123', 'A bright skyline', 'https://cdn.example.test/media-123.png', 'dall-e-3', '1024x1024'),
            timestamp,
            metadata: {
                model: 'dall-e-3',
                size: '1024x1024',
                mimeType: 'image/png',
            }
        }, {
            isAuthenticated: true,
            accessToken: 'token-123',
        });

        const [, requestInit] = (global.fetch as jest.Mock).mock.calls[0];
        const payload = JSON.parse(requestInit.body as string);

        expect(payload).toEqual(expect.objectContaining({
            type: 'media',
            timestamp: timestamp.toISOString(),
            payload: expect.objectContaining({
                mimeType: 'image/png',
                fileName: 'media-123.png',
                storageMode: 'cloud',
                url: 'https://cdn.example.test/media-123.png',
                generationPrompt: 'A bright skyline',
                generationModel: 'dall-e-3',
                metadata: expect.objectContaining({
                    legacyMediaId: 'media-123',
                    size: '1024x1024',
                })
            })
        }));
    });
});
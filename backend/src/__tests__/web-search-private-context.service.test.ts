import { LLMConfig } from '../models/LLMConfig.model';
import { LocalLLMProfile } from '../models/LocalLLMProfile.model';
import { resolveWebSearchPrivateContext } from '../services/webSearchPrivateContext.service';

describe('resolveWebSearchPrivateContext', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('resolves a local LLM profile endpoint and rewrites localhost for sandbox use', async () => {
        jest.spyOn(LocalLLMProfile, 'findOne').mockReturnValue({
            lean: jest.fn().mockResolvedValue({ endpoint: 'http://localhost:11434' }),
        } as any);

        const resolved = await resolveWebSearchPrivateContext(
            'web_search_py',
            '507f1f77bcf86cd799439011',
            {
                web_search: {
                    params: { allowed_domains: ['example.com'] },
                    llm: {
                        provider: 'LLM local (on premise)',
                        model: 'qwen-test',
                        localLLMProfileId: '507f1f77bcf86cd799439012',
                    },
                },
            },
            'Bearer jwt-test-token',
        );

        expect(resolved).toEqual(expect.objectContaining({
            web_search: expect.objectContaining({
                params: { allowed_domains: ['example.com'] },
                llm_runtime: expect.objectContaining({
                    provider: 'LLM local (on premise)',
                    model: 'qwen-test',
                    endpoint: 'http://host.docker.internal:11434',
                    transport: 'application-backend',
                    completion_api_url: 'http://host.docker.internal:3001/api/web-search/hidden-llm/complete',
                    auth_token: 'jwt-test-token',
                }),
            }),
        }));
    });

    it('resolves a cloud API key server-side without exposing storage details', async () => {
        jest.spyOn(LLMConfig, 'findOne').mockResolvedValue({
            getDecryptedApiKey: jest.fn().mockReturnValue('sk-test-key'),
        } as any);

        const resolved = await resolveWebSearchPrivateContext(
            'web_search_py',
            '507f1f77bcf86cd799439011',
            {
                web_search: {
                    params: { query_transformation: 'prompt' },
                    llm: {
                        provider: 'OpenAI',
                        model: 'gpt-4o-mini',
                    },
                },
            },
            'Bearer jwt-test-key',
        );

        expect(resolved).toEqual(expect.objectContaining({
            web_search: expect.objectContaining({
                llm_runtime: expect.objectContaining({
                    provider: 'OpenAI',
                    model: 'gpt-4o-mini',
                    api_key: 'sk-test-key',
                    transport: 'application-backend',
                    completion_api_url: 'http://host.docker.internal:3001/api/web-search/hidden-llm/complete',
                    auth_token: 'jwt-test-key',
                }),
            }),
        }));
    });
});
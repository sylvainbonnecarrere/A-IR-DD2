import express from 'express';
import passport from 'passport';
import request from 'supertest';
import '../middleware/auth.middleware';
import webSearchHiddenLlmRoutes from '../routes/web-search-hidden-llm.routes';
import { generateAccessToken } from '../utils/jwt';
import * as lmstudioProxyService from '../services/lmstudioProxy.service';
import { User } from '../models/User.model';

const app = express();
app.use(express.json());
app.use(passport.initialize());
app.use('/api/web-search/hidden-llm', webSearchHiddenLlmRoutes);

describe('web-search hidden llm routes', () => {
    afterEach(async () => {
        jest.restoreAllMocks();
        await User.deleteMany({ email: /hidden-llm-route-/i });
    });

    async function createFixture() {
        const timestamp = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const user = await User.create({
            email: `hidden-llm-route-${timestamp}@test.local`,
            password: 'test-only-password-123',
            username: `hiddenllmroute${Date.now()}`,
        });

        const accessToken = generateAccessToken({
            sub: user.id,
            email: user.email,
            role: user.role,
        });

        return { accessToken };
    }

    it('uses the existing local chat proxy path for openai-compatible local runtimes', async () => {
        const { accessToken } = await createFixture();

        const fetchChatCompletionSpy = jest.spyOn(lmstudioProxyService, 'fetchChatCompletion').mockResolvedValue({
            choices: [{ message: { content: 'query reformulated' } }],
        } as any);

        const response = await request(app)
            .post('/api/web-search/hidden-llm/complete')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
                runtime: {
                    provider: 'LLM local (on premise)',
                    model: 'local-model',
                    endpoint: 'http://host.docker.internal:11434',
                },
                systemPrompt: 'CTX=["language:fr"]',
                userPrompt: 'Quelle est la météo pour demain à Paris ?',
                timeoutSeconds: 120,
                maxTokens: 220,
            });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ text: 'query reformulated' });
        expect(lmstudioProxyService.fetchChatCompletion).toHaveBeenCalledWith(
            'http://host.docker.internal:11434',
            expect.objectContaining({
                model: 'local-model',
                max_tokens: 220,
                stream: false,
            }),
            expect.any(Number),
        );
        expect(fetchChatCompletionSpy.mock.calls[0][1]).toEqual(expect.objectContaining({
            messages: [
                { role: 'system', content: 'CTX=["language:fr"]' },
                { role: 'user', content: 'Quelle est la météo pour demain à Paris ?' },
            ],
        }));
    });

    it('keeps the hidden transform prompt unchanged for local runtimes', async () => {
        const { accessToken } = await createFixture();

        const fetchChatCompletionSpy = jest.spyOn(lmstudioProxyService, 'fetchChatCompletion').mockResolvedValue({
            choices: [{ message: { content: 'paris météo demain prévisions' } }],
        } as any);

        const response = await request(app)
            .post('/api/web-search/hidden-llm/complete')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
                runtime: {
                    provider: 'LLM local (on premise)',
                    model: 'qwen/qwen3.5-9b',
                    endpoint: 'http://192.168.56.1:1234',
                },
                systemPrompt: 'Q={{user_query}}',
                userPrompt: 'météo demain Paris',
                timeoutSeconds: 120,
                maxTokens: 220,
            });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ text: 'paris météo demain prévisions' });
        expect(fetchChatCompletionSpy).toHaveBeenCalledWith(
            'http://192.168.56.1:1234',
            expect.objectContaining({
                model: 'qwen/qwen3.5-9b',
                messages: [
                    { role: 'system', content: 'Q={{user_query}}' },
                    { role: 'user', content: 'météo demain Paris' },
                ],
            }),
            expect.any(Number),
        );
    });

    it('falls back to the usual Ollama /api/chat endpoint when the local server rejects /v1/chat/completions', async () => {
        const { accessToken } = await createFixture();

        jest.spyOn(lmstudioProxyService, 'fetchChatCompletion').mockRejectedValue(new Error('LMStudio API error: 404 - {"error":"Unexpected endpoint or method. (POST /v1/chat/completions)"}'));

        const originalFetch = global.fetch;
        global.fetch = jest.fn(async () => ({
            ok: true,
            json: async () => ({
                message: {
                    content: 'query reformulated by ollama',
                },
            }),
        } as Response)) as typeof fetch;

        try {
            const response = await request(app)
                .post('/api/web-search/hidden-llm/complete')
                .set('Authorization', `Bearer ${accessToken}`)
                .send({
                    runtime: {
                        provider: 'LLM local (on premise)',
                        model: 'llama3.2',
                        endpoint: 'http://host.docker.internal:11434',
                    },
                    systemPrompt: 'CTX=["language:fr"]',
                    userPrompt: 'Quelle est la météo pour demain à Paris ?',
                    timeoutSeconds: 120,
                    maxTokens: 220,
                });

            expect(response.status).toBe(200);
            expect(response.body).toEqual({ text: 'query reformulated by ollama' });
            expect(global.fetch).toHaveBeenCalledWith(
                'http://host.docker.internal:11434/api/chat',
                expect.objectContaining({ method: 'POST', signal: expect.any(Object) }),
            );
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('retries once when LMStudio reports a transient model reload', async () => {
        const { accessToken } = await createFixture();

        const fetchChatCompletionSpy = jest.spyOn(lmstudioProxyService, 'fetchChatCompletion');
        fetchChatCompletionSpy
            .mockRejectedValueOnce(new Error('LMStudio API error: 400 - {"error":"Model reloaded."}'))
            .mockResolvedValueOnce({
                choices: [{ message: { content: 'query reformulated after reload' } }],
            } as any);

        const response = await request(app)
            .post('/api/web-search/hidden-llm/complete')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
                runtime: {
                    provider: 'LLM local (on premise)',
                    model: 'qwen/qwen3.5-9b',
                    endpoint: 'http://192.168.56.1:1234',
                },
                systemPrompt: 'CTX=["language:fr"]',
                userPrompt: 'Quelle est la météo pour demain à Paris ?',
                timeoutSeconds: 120,
                maxTokens: 220,
            });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ text: 'query reformulated after reload' });
        expect(fetchChatCompletionSpy).toHaveBeenCalledTimes(2);
    });

    it('retries once with a larger token budget when LMStudio returns only reasoning_content with finish_reason=length', async () => {
        const { accessToken } = await createFixture();

        const fetchChatCompletionSpy = jest.spyOn(lmstudioProxyService, 'fetchChatCompletion');
        fetchChatCompletionSpy
            .mockResolvedValueOnce({
                choices: [{
                    finish_reason: 'length',
                    message: {
                        role: 'assistant',
                        content: '',
                        reasoning_content: 'Thinking Process: analyse en cours'
                    }
                }],
            } as any)
            .mockResolvedValueOnce({
                choices: [{
                    finish_reason: 'stop',
                    message: {
                        role: 'assistant',
                        content: 'météo demain Paris prévisions temps',
                    }
                }],
            } as any);

        const response = await request(app)
            .post('/api/web-search/hidden-llm/complete')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
                runtime: {
                    provider: 'LLM local (on premise)',
                    model: 'qwen/qwen3.5-9b',
                    endpoint: 'http://192.168.56.1:1234',
                },
                systemPrompt: 'Q=météo Paris demain',
                userPrompt: 'météo Paris demain',
                timeoutSeconds: 120,
                maxTokens: 220,
            });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ text: 'météo demain Paris prévisions temps' });
        expect(fetchChatCompletionSpy).toHaveBeenCalledTimes(2);
        expect(fetchChatCompletionSpy.mock.calls[0][1]).toEqual(expect.objectContaining({
            max_tokens: 220,
        }));
        expect(fetchChatCompletionSpy.mock.calls[1][1]).toEqual(expect.objectContaining({
            max_tokens: 660,
        }));
    });

    it('does not retry reasoning-length exhaustion when allowReasoningRetry=false', async () => {
        const { accessToken } = await createFixture();

        const fetchChatCompletionSpy = jest.spyOn(lmstudioProxyService, 'fetchChatCompletion');
        fetchChatCompletionSpy.mockResolvedValueOnce({
            choices: [{
                finish_reason: 'length',
                message: {
                    role: 'assistant',
                    content: '',
                    reasoning_content: 'Thinking Process: analyse en cours'
                }
            }],
        } as any);

        const response = await request(app)
            .post('/api/web-search/hidden-llm/complete')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
                runtime: {
                    provider: 'LLM local (on premise)',
                    model: 'qwen/qwen3.5-9b',
                    endpoint: 'http://192.168.56.1:1234',
                },
                systemPrompt: 'Q=météo Paris demain',
                userPrompt: 'météo Paris demain',
                timeoutSeconds: 15,
                maxTokens: 220,
                allowReasoningRetry: false,
            });

        expect(response.status).toBe(500);
        expect(response.body.error).toContain('contenu final vide après reasoning');
        expect(fetchChatCompletionSpy).toHaveBeenCalledTimes(1);
    });
});
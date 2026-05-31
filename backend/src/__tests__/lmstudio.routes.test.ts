import express from 'express';
import request from 'supertest';
import lmstudioRoutes from '../routes/lmstudio.routes';
import * as lmstudioProxyService from '../services/lmstudioProxy.service';

describe('LMStudio routes streaming handshake', () => {
    const app = express();
    app.use(express.json());
    app.use('/api/lmstudio', lmstudioRoutes);

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('returns structured HTTP error when upstream handshake fails before SSE commit', async () => {
        jest.spyOn(lmstudioProxyService, 'openChatCompletionStream').mockRejectedValue(
            new lmstudioProxyService.LMStudioProxyError('timeout', 'LMStudio request timeout exceeded after 600000ms', {
                statusCode: 504,
                endpoint: 'http://localhost:1234',
                details: { timeoutMs: 600000 }
            })
        );

        const response = await request(app)
            .post('/api/lmstudio/chat/completions')
            .send({
                endpoint: 'http://localhost:1234',
                model: 'local-model',
                messages: [{ role: 'user', content: 'hello' }],
                stream: true,
            })
            .expect(504);

        expect(response.headers['content-type']).toContain('application/json');
        expect(response.body).toEqual(expect.objectContaining({
            code: 'timeout',
            error: 'LMStudio request timeout exceeded after 600000ms'
        }));
    });

    it('commits SSE only after a valid stream session handshake succeeds', async () => {
        jest.spyOn(lmstudioProxyService, 'openChatCompletionStream').mockResolvedValue({
            firstChunk: 'data: {"chunk":1}\n\n',
            async *stream() {
                yield 'data: [DONE]\n\n';
            }
        });

        const response = await request(app)
            .post('/api/lmstudio/chat/completions')
            .send({
                endpoint: 'http://localhost:1234',
                model: 'local-model',
                messages: [{ role: 'user', content: 'hello' }],
                stream: true,
            })
            .expect(200);

        expect(response.headers['content-type']).toContain('text/event-stream');
        expect(response.text).toContain(': connected');
        expect(response.text).toContain('data: {"chunk":1}');
        expect(response.text).toContain('data: [DONE]');
    });
});
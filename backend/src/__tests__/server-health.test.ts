import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../server';

describe('backend health endpoints', () => {
    it('keeps liveness available and reports Mongo-backed worker readiness', async () => {
        const liveness = await request(app).get('/api/health');
        expect(liveness.status).toBe(200);
        expect(liveness.body).toMatchObject({ status: 'OK' });

        const readiness = await request(app).get('/api/health/ready');
        expect(readiness.status).toBe(mongoose.connection.readyState === 1 ? 200 : 503);
        expect(readiness.body).toMatchObject({
            status: mongoose.connection.readyState === 1 ? 'ready' : 'not_ready',
            components: {
                database: mongoose.connection.readyState === 1 ? 'connected' : 'unavailable',
                durableRunWorker: 'disabled',
            },
        });
    });
});

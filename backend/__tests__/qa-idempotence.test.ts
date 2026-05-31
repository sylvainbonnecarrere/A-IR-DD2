import request from 'supertest';
import { app } from '../src/server';
import { User } from '../src/models/User.model';
import { cleanupQaUser, extractWorkflowId, registerQaUser } from './qa-workflows.helpers';

describe('QA idempotence regression coverage', () => {
    const createdUserIds: string[] = [];

    afterEach(async () => {
        while (createdUserIds.length > 0) {
            await cleanupQaUser(createdUserIds.pop()!);
        }
    });

    it('keeps GET /api/workflows idempotent while healing user pointers', async () => {
        const registration = await registerQaUser('qa-idempotence');
        createdUserIds.push(registration.userId);

        await User.findByIdAndUpdate(registration.userId, {
            defaultWorkflowId: null,
            lastActiveWorkflowId: null,
            workflowCount: 0
        });

        const firstResponse = await request(app)
            .get('/api/workflows')
            .set('Authorization', `Bearer ${registration.accessToken}`)
            .expect(200);

        const secondResponse = await request(app)
            .get('/api/workflows')
            .set('Authorization', `Bearer ${registration.accessToken}`)
            .expect(200);

        expect(firstResponse.body.workflows).toHaveLength(1);
        expect(secondResponse.body.workflows).toHaveLength(1);

        const firstWorkflowId = extractWorkflowId(firstResponse.body.workflows[0]);
        const secondWorkflowId = extractWorkflowId(secondResponse.body.workflows[0]);

        expect(firstWorkflowId).toBeTruthy();
        expect(secondWorkflowId).toBe(firstWorkflowId);

        const healedUser = await User.findById(registration.userId).lean();
        expect(healedUser?.workflowCount).toBe(1);
        expect(String(healedUser?.defaultWorkflowId ?? '')).toBe(firstWorkflowId);
        expect(String(healedUser?.lastActiveWorkflowId ?? '')).toBe(firstWorkflowId);
    });
});
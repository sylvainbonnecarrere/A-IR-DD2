import request from 'supertest';
import { app } from '../src/server';
import { cleanupQaUser, extractWorkflowId, loginQaUser, registerQaUser } from './qa-workflows.helpers';

describe('QA real browser flow regression coverage', () => {
    const createdUserIds: string[] = [];

    afterEach(async () => {
        while (createdUserIds.length > 0) {
            await cleanupQaUser(createdUserIds.pop()!);
        }
    });

    it('simulates register, login, hydrate, and workflow list display for a fresh user', async () => {
        const registration = await registerQaUser('qa-browser-flow');
        createdUserIds.push(registration.userId);

        const login = await loginQaUser(registration.email);

        const workspaceBeforeResponse = await request(app)
            .get('/api/user/workspace')
            .set('Authorization', `Bearer ${login.accessToken}`)
            .expect(200);

        const workspaceBeforeId = extractWorkflowId(workspaceBeforeResponse.body.workflow);
        expect(workspaceBeforeId).toBeTruthy();

        const workflowsResponse = await request(app)
            .get('/api/workflows')
            .set('Authorization', `Bearer ${login.accessToken}`)
            .expect(200);

        expect(workflowsResponse.body.workflows).toHaveLength(1);
        expect(extractWorkflowId(workflowsResponse.body.workflows[0])).toBe(workspaceBeforeId);
        expect(workflowsResponse.body.workflows[0]).toEqual(expect.objectContaining({
            name: expect.any(String),
            isDefault: true,
            isActive: true,
            agentCount: expect.any(Number)
        }));

        const workspaceAfterResponse = await request(app)
            .get('/api/user/workspace')
            .set('Authorization', `Bearer ${login.accessToken}`)
            .expect(200);

        expect(extractWorkflowId(workspaceAfterResponse.body.workflow)).toBe(workspaceBeforeId);
    });
});
import request from 'supertest';
import { app } from '../src/server';
import { cleanupQaUser, extractWorkflowId, loginQaUser, registerQaUser } from './qa-workflows.helpers';

describe('QA diagnostic workflow regression coverage', () => {
    const createdUserIds: string[] = [];

    afterEach(async () => {
        while (createdUserIds.length > 0) {
            await cleanupQaUser(createdUserIds.pop()!);
        }
    });

    it('keeps workspace hydration and workflows listing consistent for a fresh user', async () => {
        const registration = await registerQaUser('qa-diagnostic');
        createdUserIds.push(registration.userId);

        const login = await loginQaUser(registration.email);

        const workspaceResponse = await request(app)
            .get('/api/user/workspace')
            .set('Authorization', `Bearer ${login.accessToken}`)
            .expect(200);

        const workspaceWorkflowId = extractWorkflowId(workspaceResponse.body.workflow);

        expect(workspaceWorkflowId).toBeTruthy();
        expect(workspaceResponse.body.workflow).toEqual(expect.objectContaining({
            id: workspaceWorkflowId,
            name: expect.any(String)
        }));

        const workflowsResponse = await request(app)
            .get('/api/workflows')
            .set('Authorization', `Bearer ${login.accessToken}`)
            .expect(200);

        expect(Array.isArray(workflowsResponse.body.workflows)).toBe(true);
        expect(workflowsResponse.body.workflows.length).toBeGreaterThan(0);

        const workflowIds = workflowsResponse.body.workflows.map((workflow: any) => extractWorkflowId(workflow));
        expect(workflowIds).toContain(workspaceWorkflowId);
        expect(workflowsResponse.body.workflows).toEqual(expect.arrayContaining([
            expect.objectContaining({
                agentCount: expect.any(Number),
                isActive: expect.any(Boolean),
                isDefault: expect.any(Boolean)
            })
        ]));
    });
});
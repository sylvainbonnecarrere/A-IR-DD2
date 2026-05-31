import request from 'supertest';
import { app } from '../src/server';
import { cleanupQaUser, createWorkflow, extractWorkflowId, loginQaUser, registerQaUser } from './qa-workflows.helpers';

describe('QA real browser revisit regression coverage', () => {
    const createdUserIds: string[] = [];

    afterEach(async () => {
        while (createdUserIds.length > 0) {
            await cleanupQaUser(createdUserIds.pop()!);
        }
    });

    it('keeps the selected workflow visible after a new login and browser revisit', async () => {
        const registration = await registerQaUser('qa-browser-revisit');
        createdUserIds.push(registration.userId);

        const secondWorkflow = await createWorkflow(registration.accessToken, 'QA Revisit Workflow');
        const secondWorkflowId = extractWorkflowId(secondWorkflow);

        await request(app)
            .post(`/api/workflows/${secondWorkflowId}/select`)
            .set('Authorization', `Bearer ${registration.accessToken}`)
            .expect(200);

        const revisitLogin = await loginQaUser(registration.email);

        const workspaceResponse = await request(app)
            .get('/api/user/workspace')
            .set('Authorization', `Bearer ${revisitLogin.accessToken}`)
            .expect(200);

        expect(extractWorkflowId(workspaceResponse.body.workflow)).toBe(secondWorkflowId);

        const workflowsResponse = await request(app)
            .get('/api/workflows')
            .set('Authorization', `Bearer ${revisitLogin.accessToken}`)
            .expect(200);

        expect(workflowsResponse.body.workflows).toHaveLength(2);

        const selectedWorkflow = workflowsResponse.body.workflows.find(
            (workflow: any) => extractWorkflowId(workflow) === secondWorkflowId
        );

        expect(selectedWorkflow).toEqual(expect.objectContaining({
            isActive: true,
            isDefault: true,
            agentCount: expect.any(Number)
        }));
    });
});
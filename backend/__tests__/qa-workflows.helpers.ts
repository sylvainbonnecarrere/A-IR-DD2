import request from 'supertest';
import { app } from '../src/server';
import { User } from '../src/models/User.model';
import { Workflow } from '../src/models/Workflow.model';
import { AgentInstance } from '../src/models/AgentInstance.model';
import { WorkflowEdge } from '../src/models/WorkflowEdge.model';
import { AgentPrototype } from '../src/models/AgentPrototype.model';
import { AgentJournal } from '../src/models/AgentJournal.model';
import { UserToolRun } from '../src/models/UserToolRun.model';
import { Workspace } from '../src/models/Workspace.model';

export const QA_TEST_PASSWORD = 'Password123';

export interface QaAuthSession {
    email: string;
    accessToken: string;
    refreshToken: string;
    userId: string;
}

function buildQaEmail(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;
}

export function extractWorkflowId(workflow: any): string {
    return String(workflow?.id ?? workflow?._id ?? '');
}

export async function registerQaUser(prefix: string): Promise<QaAuthSession> {
    const email = buildQaEmail(prefix);
    const response = await request(app)
        .post('/api/auth/register')
        .send({
            email,
            password: QA_TEST_PASSWORD
        });

    if (response.status !== 201) {
        throw new Error(`Register failed with status ${response.status}: ${JSON.stringify(response.body)}`);
    }

    return {
        email,
        accessToken: response.body.accessToken,
        refreshToken: response.body.refreshToken,
        userId: response.body.user.id
    };
}

export async function loginQaUser(email: string): Promise<QaAuthSession> {
    const response = await request(app)
        .post('/api/auth/login')
        .send({
            email,
            password: QA_TEST_PASSWORD
        });

    if (response.status !== 200) {
        throw new Error(`Login failed with status ${response.status}: ${JSON.stringify(response.body)}`);
    }

    return {
        email,
        accessToken: response.body.accessToken,
        refreshToken: response.body.refreshToken,
        userId: response.body.user.id
    };
}

export async function createWorkflow(accessToken: string, name: string) {
    const response = await request(app)
        .post('/api/workflows')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name, description: `${name} description` });

    if (response.status !== 201) {
        throw new Error(`Workflow creation failed with status ${response.status}: ${JSON.stringify(response.body)}`);
    }

    return response.body;
}

export async function cleanupQaUser(userId: string) {
    const workflows = await Workflow.find({ userId });
    const workflowIds = workflows.map((workflow) => workflow._id);

    if (workflowIds.length > 0) {
        await AgentJournal.deleteMany({ workflowId: { $in: workflowIds } });
        await WorkflowEdge.deleteMany({ workflowId: { $in: workflowIds } });
        await AgentInstance.deleteMany({ workflowId: { $in: workflowIds } });
        await AgentPrototype.deleteMany({ workflowId: { $in: workflowIds } });
        await UserToolRun.deleteMany({ workflowId: { $in: workflowIds } });
        await Workspace.deleteMany({ scopeType: 'workflow', scopeId: { $in: workflowIds } });
        await Workflow.deleteMany({ _id: { $in: workflowIds } });
    }

    await User.deleteOne({ _id: userId });
}
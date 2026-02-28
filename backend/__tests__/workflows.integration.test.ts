/**
 * @file workflows.integration.test.ts
 * @description Tests d'intégration pour les endpoints workflows - Phase 1 Multiple Workflows
 * @scope API Routes & Controllers
 */

import request from 'supertest';
import mongoose from 'mongoose';
import { Workflow } from '../src/models/Workflow.model';
import { User } from '../src/models/User.model';
import { AgentInstance } from '../src/models/AgentInstance.model';
import { WorkflowEdge } from '../src/models/WorkflowEdge.model';
import { app } from '../src/server';

describe('📡 Workflows Integration Tests - Phase 1', () => {
    let authToken: string;
    let testUser: any;
    let firstWorkflowId: string;
    
    beforeEach(async () => {
        // Clean up before each test
        await Workflow.deleteMany({});
        await User.deleteMany({});
        await AgentInstance.deleteMany({});
        await WorkflowEdge.deleteMany({});
    });
    
    describe('1. User Registration & Workflow Creation', () => {
        it('✅ should create default workflow on registration', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'user@test.com',
                    password: 'TestPassword123'
                });
            
            expect(res.status).toBe(201);
            expect(res.body.accessToken).toBeDefined();
            
            authToken = res.body.accessToken;
            testUser = res.body.user;
            
            // Check that default workflow was created
            const workflow = await Workflow.findOne({
                userId: testUser.id,
                isDefault: true
            });
            
            expect(workflow).toBeDefined();
            expect(workflow?.isActive).toBe(true);
            firstWorkflowId = workflow!._id.toString();
        });
    });
    
    describe('2. POST /api/workflows - Create Workflow', () => {
        beforeEach(async () => {
            // Register user
            const res = await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'creator@test.com',
                    password: 'TestPassword123'
                });
            authToken = res.body.accessToken;
            testUser = res.body.user;
        });
        
        it('✅ should create new workflow', async () => {
            const res = await request(app)
                .post('/api/workflows')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    name: 'My Second Workflow',
                    description: 'Test workflow'
                });
            
            expect(res.status).toBe(201);
            expect(res.body.name).toBe('My Second Workflow');
            expect(res.body.description).toBe('Test workflow');
            expect(res.body.isActive).toBe(false); // Second should not be active
            expect(res.body.isDefault).toBe(false);
        });
        
        it('✅ should increment workflowCount', async () => {
            // Create a workflow
            await request(app)
                .post('/api/workflows')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    name: 'New Workflow'
                });
            
            // Check user workflowCount increased
            const user = await User.findById(testUser.id);
            expect(user?.workflowCount).toBe(2); // 1 default + 1 created
        });
    });
    
    describe('3. POST /api/workflows/:id/select - Activate Workflow', () => {
        let wf1Id: string;
        let wf2Id: string;
        
        beforeEach(async () => {
            // Register and get token
            const registerRes = await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'selector@test.com',
                    password: 'TestPassword123'
                });
            authToken = registerRes.body.accessToken;
            testUser = registerRes.body.user;
            
            // Get default workflow
            const defaultWf = await Workflow.findOne({
                userId: testUser.id,
                isDefault: true
            });
            wf1Id = defaultWf!._id.toString();
            
            // Create second workflow
            const createRes = await request(app)
                .post('/api/workflows')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    name: 'Second Workflow'
                });
            wf2Id = createRes.body._id;
        });
        
        it('✅ should activate workflow', async () => {
            const res = await request(app)
                .post(`/api/workflows/${wf2Id}/select`)
                .set('Authorization', `Bearer ${authToken}`);
            
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.reloadedData).toBeDefined();
            expect(res.body.workflow.isActive).toBe(true);
        });
        
        it('✅ should deactivate other workflows on select', async () => {
            // Select second workflow
            await request(app)
                .post(`/api/workflows/${wf2Id}/select`)
                .set('Authorization', `Bearer ${authToken}`);
            
            // Check first is inactive
            const firstWf = await Workflow.findById(wf1Id);
            expect(firstWf?.isActive).toBe(false);
            
            // Check second is active
            const secondWf = await Workflow.findById(wf2Id);
            expect(secondWf?.isActive).toBe(true);
        });
        
        it('✅ should return reloadedData with agents & edges', async () => {
            // Create agent instance in second workflow
            const agent = new AgentInstance({
                workflowId: wf2Id,
                prototypeId: new mongoose.Types.ObjectId(),
                name: 'Test Agent'
            });
            await agent.save();
            
            const res = await request(app)
                .post(`/api/workflows/${wf2Id}/select`)
                .set('Authorization', `Bearer ${authToken}`);
            
            expect(res.body.reloadedData.agents).toBeDefined();
            expect(Array.isArray(res.body.reloadedData.agents)).toBe(true);
            expect(res.body.reloadedData.agents.length).toBe(1);
        });
    });
    
    describe('4. GET /api/workflows/:id/stats - Get Workflow Stats', () => {
        let workflowId: string;
        
        beforeEach(async () => {
            const registerRes = await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'statter@test.com',
                    password: 'TestPassword123'
                });
            authToken = registerRes.body.accessToken;
            testUser = registerRes.body.user;
            
            const workflow = await Workflow.findOne({ userId: testUser.id });
            workflowId = workflow!._id.toString();
        });
        
        it('✅ should return workflow stats', async () => {
            const res = await request(app)
                .get(`/api/workflows/${workflowId}/stats`)
                .set('Authorization', `Bearer ${authToken}`);
            
            expect(res.status).toBe(200);
            expect(res.body._id).toBeDefined();
            expect(res.body.name).toBeDefined();
            expect(res.body.agentInstanceCount).toBe(0);
            expect(res.body.nodeCount).toBe(0);
        });
        
        it('✅ should count agents and nodes', async () => {
            // Add agents
            const agent1 = new AgentInstance({
                workflowId,
                prototypeId: new mongoose.Types.ObjectId(),
                name: 'Agent 1'
            });
            const agent2 = new AgentInstance({
                workflowId,
                prototypeId: new mongoose.Types.ObjectId(),
                name: 'Agent 2'
            });
            await Promise.all([agent1.save(), agent2.save()]);
            
            const res = await request(app)
                .get(`/api/workflows/${workflowId}/stats`)
                .set('Authorization', `Bearer ${authToken}`);
            
            expect(res.body.agentInstanceCount).toBe(2);
        });
    });
    
    describe('5. DELETE /api/workflows/:id - Delete Workflow', () => {
        let wf1Id: string;
        let wf2Id: string;
        
        beforeEach(async () => {
            const registerRes = await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'deleter@test.com',
                    password: 'TestPassword123'
                });
            authToken = registerRes.body.accessToken;
            testUser = registerRes.body.user;
            
            // Get default workflow
            const defaultWf = await Workflow.findOne({ userId: testUser.id });
            wf1Id = defaultWf!._id.toString();
            
            // Create second
            const createRes = await request(app)
                .post('/api/workflows')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ name: 'Second' });
            wf2Id = createRes.body._id;
        });
        
        it('❌ should prevent deletion of last workflow', async () => {
            // First, delete the second workflow
            await request(app)
                .delete(`/api/workflows/${wf2Id}`)
                .set('Authorization', `Bearer ${authToken}`);
            
            // Try to delete the first (only remaining)
            const res = await request(app)
                .delete(`/api/workflows/${wf1Id}`)
                .set('Authorization', `Bearer ${authToken}`);
            
            expect(res.status).toBe(400);
            expect(res.body.code).toBe('LAST_WORKFLOW');
        });
        
        it('✅ should delete workflow and cascade to agents/edges', async () => {
            // Add agents to second workflow
            const agent = new AgentInstance({
                workflowId: wf2Id,
                prototypeId: new mongoose.Types.ObjectId(),
                name: 'Test Agent'
            });
            await agent.save();
            
            // Delete second workflow
            const res = await request(app)
                .delete(`/api/workflows/${wf2Id}`)
                .set('Authorization', `Bearer ${authToken}`);
            
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.cascade.agentsDeleted).toBe(1);
            
            // Verify agent is gone
            const deletedAgent = await AgentInstance.findById(agent._id);
            expect(deletedAgent).toBeNull();
        });
        
        it('✅ should reassign defaultWorkflowId if deleted workflow was default', async () => {
            // Verify wf1 is default
            let user = await User.findById(testUser.id);
            expect(user?.defaultWorkflowId?.toString()).toBe(wf1Id);
            
            // Delete default workflow
            await request(app)
                .delete(`/api/workflows/${wf1Id}`)
                .set('Authorization', `Bearer ${authToken}`);
            
            // Check that wf2 is now default
            user = await User.findById(testUser.id);
            expect(user?.defaultWorkflowId?.toString()).toBe(wf2Id);
            
            // Check wf2 has isDefault=true
            const wf2 = await Workflow.findById(wf2Id);
            expect(wf2?.isDefault).toBe(true);
        });
        
        it('✅ should decrement workflowCount', async () => {
            const userBefore = await User.findById(testUser.id);
            const countBefore = userBefore?.workflowCount || 0;
            
            // Delete workflow
            await request(app)
                .delete(`/api/workflows/${wf2Id}`)
                .set('Authorization', `Bearer ${authToken}`);
            
            const userAfter = await User.findById(testUser.id);
            expect(userAfter?.workflowCount).toBe(countBefore - 1);
        });
    });
    
    describe('6. Authorization & Ownership', () => {
        let otherAuthToken: string;
        let workflowId: string;
        
        beforeEach(async () => {
            // Create first user's workflow
            let res = await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'owner@test.com',
                    password: 'TestPassword123'
                });
            authToken = res.body.accessToken;
            
            const workflow = await Workflow.findOne({ userId: res.body.user.id });
            workflowId = workflow!._id.toString();
            
            // Create second user
            res = await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'other@test.com',
                    password: 'TestPassword123'
                });
            otherAuthToken = res.body.accessToken;
        });
        
        it('❌ should prevent access to other user workflows', async () => {
            const res = await request(app)
                .get(`/api/workflows/${workflowId}`)
                .set('Authorization', `Bearer ${otherAuthToken}`);
            
            expect(res.status).toBe(401);
        });
        
        it('❌ should prevent deletion of other user workflows', async () => {
            const res = await request(app)
                .delete(`/api/workflows/${workflowId}`)
                .set('Authorization', `Bearer ${otherAuthToken}`);
            
            expect(res.status).toBe(401);
        });
    });
});

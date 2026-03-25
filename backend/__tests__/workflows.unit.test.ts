/**
 * @file workflows.unit.test.ts
 * @description Tests unitaires pour les workflows - Phase 1 Multiple Workflows
 * @scope Models & Data Layer
 */

import mongoose from 'mongoose';
import { Workflow, IWorkflow } from '../src/models/Workflow.model';
import { User, IUser } from '../src/models/User.model';

const TEST_ONLY_PASSWORD = 'test-only-password-123';

describe('❌ Workflows Unit Tests - Phase 1', () => {
    let testUser: IUser;
    let testUserId: string;

    beforeAll(async () => {
        await Workflow.syncIndexes();
    });
    
    beforeEach(async () => {
        // Clean up collections
        await Workflow.deleteMany({});
        await User.deleteMany({});
        
        // Create test user
        testUser = new User({
            email: 'test-workflows@example.com',
            password: TEST_ONLY_PASSWORD
        });
        await testUser.save();
        testUserId = testUser._id.toString();
    });
    
    describe('1. Workflow Creation', () => {
        describe('✅ First Workflow', () => {
            it('should set isDefault=true for first workflow', async () => {
                const workflow = new Workflow({
                    userId: testUserId,
                    name: 'First Workflow',
                    isActive: true,
                    isDefault: true
                });
                
                await workflow.save();
                
                const saved = await Workflow.findById(workflow._id);
                expect(saved?.isDefault).toBe(true);
                expect(saved?.isActive).toBe(true);
            });
            
            it('should enforce unique constraint on isDefault per userId', async () => {
                // Create first workflow as default
                const wf1 = new Workflow({
                    userId: testUserId,
                    name: 'Workflow 1',
                    isDefault: true
                });
                await wf1.save();
                
                // Create second workflow as default (should violate unique partial index)
                const wf2 = new Workflow({
                    userId: testUserId,
                    name: 'Workflow 2',
                    isDefault: true
                });
                
                // Note: This test validates the index behavior
                // Actual enforcement depends on MongoDB index enforcement
                await expect(wf2.save()).rejects.toThrow(/E11000|duplicate key/i);
            });
        });
        
        describe('✅ Subsequent Workflows', () => {
            it('should allow non-default workflows', async () => {
                // First workflow
                const wf1 = new Workflow({
                    userId: testUserId,
                    name: 'First',
                    isDefault: true
                });
                await wf1.save();
                
                // Second workflow
                const wf2 = new Workflow({
                    userId: testUserId,
                    name: 'Second',
                    isDefault: false
                });
                await wf2.save();
                
                const saved = await Workflow.findById(wf2._id);
                expect(saved?.isDefault).toBe(false);
                expect(saved?.name).toBe('Second');
            });
        });
    });
    
    describe('2. User Model Extensions', () => {
        it('should have defaultWorkflowId field', async () => {
            const refreshedUser = await User.findById(testUserId);
            expect(refreshedUser).toHaveProperty('defaultWorkflowId');
            expect(refreshedUser).toHaveProperty('workflowCount');
        });
        
        it('should default workflowCount to 0', async () => {
            const freshUser = await User.findById(testUserId);
            expect(freshUser?.workflowCount).toBe(0);
        });
        
        it('should accept valid defaultWorkflowId', async () => {
            const workflow = new Workflow({
                userId: testUserId,
                name: 'Test Workflow',
                isDefault: true
            });
            await workflow.save();
            
            testUser.defaultWorkflowId = workflow._id;
            testUser.workflowCount = 1;
            await testUser.save();
            
            const saved = await User.findById(testUserId);
            expect(saved?.defaultWorkflowId?.toString()).toBe(workflow._id.toString());
            expect(saved?.workflowCount).toBe(1);
        });
    });
    
    describe('3. Workflow Indexes', () => {
        it('should have composite index on userId + isDefault', async () => {
            const indexes = Workflow.schema.indexes();
            const hasIndex = indexes.some(([key, options]) => {
                return key.userId === 1 && key.isDefault === 1 && options?.unique === true;
            });
            expect(hasIndex).toBe(true);
        });
        
        it('should have index on userId + updatedAt', async () => {
            const indexes = Workflow.schema.indexes();
            const hasIndex = indexes.some(([key]) => {
                return key.userId === 1 && key.updatedAt === -1;
            });
            expect(hasIndex).toBe(true);
        });
    });
    
    describe('4. Workflow Validation', () => {
        it('should require userId', async () => {
            const workflow = new Workflow({
                name: 'Invalid Workflow'
            });
            
            await expect(workflow.save()).rejects.toThrow();
        });
        
        it('should require name', async () => {
            const workflow = new Workflow({
                userId: testUserId
            });
            
            await expect(workflow.save()).rejects.toThrow();
        });
        
        it('should validate canvasState defaults', async () => {
            const workflow = new Workflow({
                userId: testUserId,
                name: 'Canvas Test'
            });
            
            await workflow.save();
            
            const saved = await Workflow.findById(workflow._id);
            expect({
                zoom: saved?.canvasState.zoom,
                panX: saved?.canvasState.panX,
                panY: saved?.canvasState.panY
            }).toMatchObject({
                zoom: 1,
                panX: 0,
                panY: 0
            });
        });
    });
    
    describe('5. Workflow Queries', () => {
        it('should find default workflow by userId', async () => {
            const workflow = new Workflow({
                userId: testUserId,
                name: 'Default',
                isDefault: true
            });
            await workflow.save();
            
            const found = await Workflow.findOne({
                userId: testUserId,
                isDefault: true
            });
            
            expect(found?.name).toBe('Default');
        });
        
        it('should list workflows sorted by updatedAt', async () => {
            const wf1 = new Workflow({
                userId: testUserId,
                name: 'First'
            });
            await wf1.save();
            
            // Small delay to ensure different timestamps
            await new Promise(resolve => setTimeout(resolve, 10));
            
            const wf2 = new Workflow({
                userId: testUserId,
                name: 'Second'
            });
            await wf2.save();
            
            const workflows = await Workflow.find({ userId: testUserId })
                .sort({ updatedAt: -1 });
            
            expect(workflows.length).toBe(2);
            expect(workflows[0].name).toBe('Second');
            expect(workflows[1].name).toBe('First');
        });
    });
});

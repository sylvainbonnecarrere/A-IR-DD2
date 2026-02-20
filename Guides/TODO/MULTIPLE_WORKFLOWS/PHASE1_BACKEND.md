# PHASE 1 - Backend Implementation Guide

**Destinataire**: Agent Mongo-Persistance & Codeur-Spécialiste (Backend)  
**Durée estimée**: 3-4 jours  
**Risque**: Moyen (cascade delete complexity)

---

## 1. Database - Schéma & Indexes

### Task 1.1: Extend User.model.ts

**Fichier**: `backend/src/models/User.model.ts`

**IMPORTANTE**: Understanding `defaultWorkflowId` relationship:
- **Each user** has exactly **ONE** default workflow (can be null initially)
- **Each Workflow** has `isDefault: boolean` flag
- **Invariant**: For any user U:
  - At most ONE workflow where `userId === U._id AND isDefault === true`
  - This workflow is stored at `U.defaultWorkflowId`
- **On DELETE**: If deleted workflow is the default, reassign to another workflow auto
- **On CREATE**: First workflow gets automatically `isDefault: true`

```typescript
// AJOUTER dans interface IUser
defaultWorkflowId?: mongoose.Types.ObjectId;  // ⭐ Workflow marked as default for this user
workflowCount: number;                         // Tracking count for analytics

// AJOUTER dans UserSchema
defaultWorkflowId: {
    type: Schema.Types.ObjectId,
    ref: 'Workflow',
    sparse: true,
    validate: {
        validator: async function(this: any, value: any) {
            if (!value) return true;
            const workflow = await Workflow.findById(value);
            return workflow?.userId?.equals(this._id);
        },
        message: 'defaultWorkflowId must belong to this user'
    }
},

workflowCount: {
    type: Number,
    default: 0,
    min: 0,
    validate: {
        validator: async function(this: any) {
            const actual = await Workflow.countDocuments({ userId: this._id });
            return actual === this.workflowCount;
        },
        message: 'workflowCount must match actual workflow count'
    }
},

// INDEXES untuk performance
UserSchema.index({ email: 1, defaultWorkflowId: 1 });
UserSchema.index({ _id: 1, defaultWorkflowId: 1 });
```

### Task 1.2: Verify Workflow.model.ts Schema

**Fichier**: `backend/src/models/Workflow.model.ts`

**Critical**: `isDefault` Property
- **One per user**: Per user, only ONE workflow can have `isDefault: true`
- **Enforced at API level**: Backend ensures invariant maintained
- **DB Constraint** (RECOMMENDED): Add unique partial index
- **If deleting default**: Auto-reassign to oldest remaining workflow

**Checklist**:
- [ ] Interface has: userId, name, isActive, isDefault, canvasState, createdAt, updatedAt
- [ ] Indexes exist: { userId: 1, isDefault: 1 }, { userId: 1, createdAt: -1 }
- [ ] **NEW**: Partial unique index on userId + isDefault (for data integrity)
- [ ] Validation: name.required, unique: false (same name allowed per user)
- [ ] Soft-delete not needed (hard delete is fine with cascade)

**Expected schema** (copy/paste validation):
```typescript
const WorkflowSchema = new Schema<IWorkflow>({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    name: { type: String, required: true, minlength: 1, maxlength: 100 },
    description: { type: String, maxlength: 500 },
    isActive: { type: Boolean, default: false },
    isDefault: { type: Boolean, default: false },  // ⭐ One per userId
    canvasState: {
        zoom: Number,
        panX: Number,
        panY: Number
    },
    isDirty: { type: Boolean, default: false },
    lastSavedAt: { type: Date, default: () => new Date() }
}, { timestamps: true });

// Indexes
WorkflowSchema.index({ userId: 1, isDefault: 1 });
WorkflowSchema.index({ userId: 1, createdAt: -1 });
WorkflowSchema.index({ userId: 1, isActive: 1 });

// ⭐ CRITICAL: Partial unique index - ensure only ONE default per user
WorkflowSchema.index(
    { userId: 1, isDefault: 1 },
    { unique: true, sparse: true, partialFilterExpression: { isDefault: true } }
);
```

### Task 1.3: Verify Other Collections Don't Need Changes

**Fields to check** (should already exist):
- [ ] `agent_instances.workflowId` (ObjectId, indexed)
- [ ] `workflow_nodes_v2.workflowId` (ObjectId)
- [ ] `workflow_edges_v2.workflowId` (ObjectId)
- [ ] `journals.workflowId` (ObjectId, indexed)

---

## 2. API Endpoints Implementation

### Task 2.1: POST /api/workflows/:id/select (NEW)

**Fichier**: `backend/src/routes/workflows.routes.ts`

**Code Template**:
```typescript
// POST /api/workflows/:id/select
router.post(
  '/:id/select',
  requireAuth,
  requireOwnershipAsync(async (req) => {
    const workflow = await Workflow.findById(req.params.id);
    return workflow ? workflow.userId.toString() : null;
  }),
  async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      const user = req.user as IUser;
      const workflowId = req.params.id;
      
      // Validate workflow exists and belongs to user
      const workflow = await Workflow.findOne({
        _id: workflowId,
        userId: user.id
      }).session(session);
      
      if (!workflow) {
        await session.abortTransaction();
        return res.status(404).json({ error: 'Workflow not found' });
      }
      
      // Update all workflows: disable others, enable this one
      await Workflow.updateMany(
        { userId: user.id, _id: { $ne: workflowId } },
        { isActive: false },
        { session }
      );
      
      await Workflow.updateOne(
        { _id: workflowId },
        { isActive: true, lastSavedAt: new Date() },
        { session }
      );
      
      // Fetch related data for this workflow
      const [agents, nodes, edges] = await Promise.all([
        AgentInstance.find({ workflowId }).session(session),
        WorkflowNodeV2.find({ workflowId }).session(session),
        WorkflowEdgeV2.find({ workflowId }).session(session)
      ]);
      
      await session.commitTransaction();
      
      const updatedWorkflow = await Workflow.findById(workflowId);
      
      res.json({
        success: true,
        workflow: updatedWorkflow,
        reloadedData: {
          agents: agents || [],
          nodes: nodes || [],
          edges: edges || [],
          canvasState: workflow.canvasState
        }
      });
      
    } catch (error) {
      await session.abortTransaction();
      console.error('[Workflows] SELECT error:', error);
      res.status(500).json({ error: 'Failed to select workflow' });
    } finally {
      await session.endSession();
    }
  }
);
```

**Validation**:
- [x] Uses Mongoose transaction
- [x] Atomically updates isActive
- [x] Returns reloadedData
- [x] Error handling with rollback

### Task 2.2: GET /api/workflows/:id/stats (NEW)

**Fichier**: `backend/src/routes/workflows.routes.ts`

```typescript
// GET /api/workflows/:id/stats
router.get(
  '/:id/stats',
  requireAuth,
  requireOwnershipAsync(async (req) => {
    const workflow = await Workflow.findById(req.params.id);
    return workflow ? workflow.userId.toString() : null;
  }),
  async (req, res) => {
    try {
      const workflow = await Workflow.findById(req.params.id);
      if (!workflow) {
        return res.status(404).json({ error: 'Workflow not found' });
      }
      
      const [agentCount, nodeCount] = await Promise.all([
        AgentInstance.countDocuments({ workflowId: workflow._id }),
        WorkflowNodeV2.countDocuments({ workflowId: workflow._id })
      ]);
      
      res.json({
        _id: workflow._id,
        name: workflow.name,
        description: workflow.description,
        isActive: workflow.isActive,
        isDefault: workflow.isDefault,
        createdAt: workflow.createdAt,
        updatedAt: workflow.updatedAt,
        lastEditedBy: workflow.lastEditedBy,
        agentInstanceCount: agentCount,
        nodeCount: nodeCount
      });
    } catch (error) {
      console.error('[Workflows] STATS error:', error);
      res.status(500).json({ error: 'Failed to get workflow stats' });
    }
  }
);
```

### Task 2.3: UPDATE DELETE /api/workflows/:id (CASCADE)

**Fichier**: `backend/src/routes/workflows.routes.ts`

**Find existing DELETE endpoint and REPLACE with:**

```typescript
// DELETE /api/workflows/:id - WITH CASCADE
router.delete(
  '/:id',
  requireAuth,
  requireOwnershipAsync(async (req) => {
    const workflow = await Workflow.findById(req.params.id);
    return workflow ? workflow.userId.toString() : null;
  }),
  async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      const user = req.user as IUser;
      const workflowId = req.params.id;
      
      // Fetch workflowto check ownership & count
      const workflow = await Workflow.findOne({
        _id: workflowId,
        userId: user.id
      }).session(session);
      
      if (!workflow) {
        await session.abortTransaction();
        return res.status(404).json({ error: 'Workflow not found' });
      }
      
      // Check: cannot delete if only workflow
      const otherWorkflowCount = await Workflow.countDocuments({
        userId: user.id,
        _id: { $ne: workflowId }
      }).session(session);
      
      if (otherWorkflowCount === 0) {
        await session.abortTransaction();
        return res.status(400).json({
          error: 'Cannot delete the only workflow',
          code: 'LAST_WORKFLOW'
        });
      }
      
      // ATOMIC CASCADE DELETE
      await Promise.all([
        Workflow.deleteOne({ _id: workflowId }, { session }),
        AgentInstance.deleteMany({ workflowId }, { session }),
        WorkflowNodeV2.deleteMany({ workflowId }, { session }),
        WorkflowEdgeV2.deleteMany({ workflowId }, { session }),
        AgentJournal.deleteMany({ workflowId }, { session })
      ]);
      
      // If this was defaultWorkflowId, reassign
      if (user.defaultWorkflowId?.equals(workflowId)) {
        const nextWorkflow = await Workflow
          .findOne({ userId: user.id })
          .sort({ createdAt: 1 })
          .session(session);
        
        if (nextWorkflow) {
          user.defaultWorkflowId = nextWorkflow._id;
          await user.save({ session });
        }
      }
      
      await session.commitTransaction();
      
      res.json({
        success: true,
        deletedWorkflowId: workflowId,
        message: 'Workflow deleted successfully'
      });
      
    } catch (error) {
      await session.abortTransaction();
      console.error('[Workflows] DELETE error:', error);
      res.status(500).json({
        error: 'Failed to delete workflow',
        details: error instanceof Error ? error.message : String(error)
      });
    } finally {
      await session.endSession();
    }
  }
);
```

### Task 2.4: Add PATCH /api/workflows/:id (UPDATE NAME/DESCRIPTION)

**Fichier**: `backend/src/routes/workflows.routes.ts`

**NEW ENDPOINT** - Allows user to edit workflow name & description:

```typescript
// PATCH /api/workflows/:id - Update name/description
router.patch(
  '/:id',
  requireAuth,
  requireOwnershipAsync(async (req) => {
    const workflow = await Workflow.findById(req.params.id);
    return workflow ? workflow.userId.toString() : null;
  }),
  async (req, res) => {
    try {
      const user = req.user as IUser;
      const workflowId = req.params.id;
      const { name, description } = req.body;

      // Validate input
      if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
        return res.status(400).json({ error: 'Invalid workflow name' });
      }
      if (description !== undefined && typeof description !== 'string') {
        return res.status(400).json({ error: 'Invalid workflow description' });
      }

      // Update workflow
      const workflow = await Workflow.findOneAndUpdate(
        { _id: workflowId, userId: user.id },
        {
          ...(name !== undefined && { name: name.trim() }),
          ...(description !== undefined && { description: description.trim() }),
          updatedAt: new Date()
        },
        { new: true, runValidators: true }
      );

      if (!workflow) {
        return res.status(404).json({ error: 'Workflow not found' });
      }

      res.json(workflow);
      
    } catch (error) {
      console.error('[Workflows] PATCH error:', error);
      res.status(500).json({ error: 'Failed to update workflow' });
    }
  }
);
```

### Task 2.5: Verify POST /api/workflows (Create)

**Current existing endpoint should:**

- [x] Already creates workflow with userId
- [ ] **ADD**: Set isDefault=true if no other workflows exist
- [ ] **ADD**: Return 201 status explicitly

**Verify code in existing POST /api/workflows**:
```typescript
const existingCount = await Workflow.countDocuments({ userId: user.id });

const workflow = new Workflow({
    userId: user.id,
    name: req.body.name || 'New Workflow',
    description: req.body.description,
    isActive: existingCount === 0,   // ✅ First is active
    isDefault: existingCount === 0,  // ✅ ENSURE: First is also default!
    isDirty: false,
    canvasState: { zoom: 1, panX: 0, panY: 0 }
});

await workflow.save();

// ⭐ IMPORTANT: Update User.defaultWorkflowId if first
if (existingCount === 0) {
    await User.findByIdAndUpdate(
        user.id,
        { defaultWorkflowId: workflow._id, workflowCount: 1 }
    );
}

res.status(201).json(workflow);  // ✅ ENSURE 201
```

### Task 2.5: Update POST /api/auth/signup

**Fichier**: `backend/src/routes/auth.routes.ts`

**Find signup endpoint and ADD after user.save():**

```typescript
router.post('/signup', validateRequest(signupSchema), async (req, res) => {
    // ... existing user creation code ...
    
    // ⭐ NEW: Create default workflow
    if (req.body.email && req.body.password) {
        try {
            const newUser = new User({
                email: req.body.email,
                password: req.body.password,
                role: 'user',
                isActive: true
            });
            
            await newUser.save();
            
            // ⭐ ATOMIC: Create default workflow
            const defaultWorkflow = new Workflow({
                userId: newUser._id,
                name: 'Mon premier workflow',
                description: 'Workflow créé par défaut',
                isActive: true,
                isDefault: true,
                canvasState: { zoom: 1, panX: 0, panY: 0 },
                isDirty: false
            });
            
            await defaultWorkflow.save();
            
            // Update user reference
            newUser.defaultWorkflowId = defaultWorkflow._id;
            newUser.workflowCount = 1;
            await newUser.save();
            
            // Return success with auth
            const token = generateJWT(newUser);
            res.status(201).json({
                user: { id: newUser._id, email: newUser.email },
                token,
                defaultWorkflow: { _id: defaultWorkflow._id, name: defaultWorkflow.name }
            });
            
        } catch (error) {
            console.error('[Auth] Signup error:', error);
            res.status(500).json({ error: 'Signup failed' });
        }
    }
});
```

---

## 3. Testing Backend

### Task 3.1: Unit Tests

**Fichier**: `backend/tests/workflows.unit.test.ts` (CREATE NEW)

```typescript
import { Workflow } from '../src/models/Workflow.model';
import { User } from '../src/models/User.model';
import mongoose from 'mongoose';

describe('Workflows - Unit Tests', () => {
  let testUser: any;
  let testWorkflowId: any;
  
  beforeEach(async () => {
    // Setup test user & workflow
    testUser = new User({ email: 'test@example.com', password: 'pass123' });
    await testUser.save();
    
    testWorkflow = new Workflow({
      userId: testUser._id,
      name: 'Test Workflow',
      isDefault: true,
      isActive: true
    });
    await testWorkflow.save();
    testWorkflowId = testWorkflow._id;
  });
  
  test('Create workflow with isDefault=true for first', async () => {
    const user = await User.findById(testUser._id);
    expect(user.defaultWorkflowId).toEqual(testWorkflowId);
  });
  
  test('Create second workflow with isActive=false', async () => {
    const wf2 = new Workflow({
      userId: testUser._id,
      name: 'Second',
      isActive: false,
      isDefault: false
    });
    await wf2.save();
    
    expect(wf2.isActive).toBe(false);
    expect(wf2.isDefault).toBe(false);
  });
  
  test('Cannot create workflow without userId', async () => {
    const badWf = new Workflow({ name: 'No User' });
    await expect(badWf.save()).rejects.toThrow();
  });
});
```

### Task 3.2: Integration Tests

**Fichier**: `backend/tests/workflows.integration.test.ts` (CREATE NEW)

```typescript
import request from 'supertest';
import app from '../src/server';
import { Workflow } from '../src/models/Workflow.model';
import { AgentInstance } from '../src/models/AgentInstance.model';

describe('Workflows - Integration Tests', () => {
  let authToken: string;
  let userId: string;
  let workflowId: string;
  
  beforeEach(async () => {
    // Auth & setup
    const signupRes = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'test@example.com', password: 'pass123' });
    
    authToken = signupRes.body.token;
    userId = signupRes.body.user.id;
    workflowId = signupRes.body.defaultWorkflow._id;
  });
  
  test('POST /api/workflows/:id/select - activates workflow', async () => {
    // Create second workflow
    const wf2Res = await request(app)
      .post('/api/workflows')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Second' });
    
    const wf2Id = wf2Res.body._id;
    
    // Select it
    const selectRes = await request(app)
      .post(`/api/workflows/${wf2Id}/select`)
      .set('Authorization', `Bearer ${authToken}`);
    
    expect(selectRes.status).toBe(200);
    expect(selectRes.body.reloadedData).toBeDefined();
    
    // Verify in DB
    const updated = await Workflow.findById(wf2Id);
    expect(updated.isActive).toBe(true);
  });
  
  test('DELETE /api/workflows/:id - cascade deletes', async () => {
    // Create agent instance in workflow
    const agent = new AgentInstance({
      workflowId,
      prototypeId: new mongoose.Types.ObjectId(),
      name: 'Test Agent'
    });
    await agent.save();
    
    // Delete workflow
    const deleteRes = await request(app)
      .delete(`/api/workflows/${workflowId}`)
      .set('Authorization', `Bearer ${authToken}`);
    
    expect(deleteRes.status).toBe(200);
    
    // Verify cascade
    const agentExists = await AgentInstance.findById(agent._id);
    expect(agentExists).toBeNull();
  });
  
  test('DELETE last workflow returns error', async () => {
    const deleteRes = await request(app)
      .delete(`/api/workflows/${workflowId}`)
      .set('Authorization', `Bearer ${authToken}`);
    
    expect(deleteRes.status).toBe(400);
    expect(deleteRes.body.code).toBe('LAST_WORKFLOW');
  });
});
```

### Task 3.3: Run Tests

```bash
# Unit tests
npm run test:unit -- workflows.unit.test.ts

# Integration tests
npm run test:integration -- workflows.integration.test.ts

# Expected: All pass, no errors
```

---

## 4. Verification Checklist

- [ ] Workflow.model.ts verified (schema correct)
- [ ] User.model.ts updated (defaultWorkflowId added)
- [ ] POST /api/workflows/:id/select implemented
- [ ] GET /api/workflows/:id/stats implemented
- [ ] DELETE /api/workflows/:id updated with cascade
- [ ] POST /api/auth/signup creates default workflow
- [ ] All unit tests passing
- [ ] All integration tests passing
- [ ] Database indexes verified
- [ ] No console errors/warnings
- [ ] Transaction rollback tested on failure

---

**Next Step**: Pass to Frontend Team (Phase 2)

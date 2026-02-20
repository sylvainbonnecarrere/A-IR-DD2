# 🏛️ ARCHITECTURE PHASE 1 - TECHNICAL HANDOFF

**Pour:** Équipe Frontend Phase 2  
**De:** ARC-1 (Architect IA) - Backend Implementation  
**Date:** Février 2026  

---

## 🗺️ VUE GLOBALE DE L'ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND (React + Zustand)              │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ useDesignStore                                           │  │
│  │ - workflows: IWorkflow[] (cache local)                  │  │
│  │ - currentWorkflowId: string (active)                    │  │
│  │ - selectWorkflow(id) → API call → reload data          │  │
│  │ - createWorkflow(name) → API call                       │  │
│  │ - deleteWorkflow(id) → API call                         │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                            ▼ HTTP
┌─────────────────────────────────────────────────────────────────┐
│                        BACKEND (Node + Express)                 │
│                                                                  │
│  ┌──────────────────── API Layer ───────────────────────────┐  │
│  │ POST   /api/workflows                (create + atomicity)│  │
│  │ POST   /api/workflows/:id/select     (activate + reload) │  │
│  │ GET    /api/workflows/:id/stats      (metadata + counts) │  │
│  │ DELETE /api/workflows/:id            (cascade + cascade) │  │
│  │ PUT    /api/workflows/:id            (update name/desc)  │  │
│  │ GET    /api/workflows                (list all)          │  │
│  └──────────────────────────────────────────────────────────┘  │
│                            ▼                                     │
│  ┌──────────────────── Service Layer ────────────────────────┐  │
│  │ WorkflowSelfHealingService                               │  │
│  │  - ensureDefaultWorkflow(userId)                         │  │
│  │  - validateWorkflowAccess(workflowId, userId)            │  │
│  │  - createDefaultWorkflowForNewUser(userId)               │  │
│  └──────────────────────────────────────────────────────────┘  │
│                            ▼                                     │
│  ┌──────────────────── Data Layer ──────────────────────────┐  │
│  │ MongoDB Collections                                      │  │
│  │ ┌─────────────┐     ┌─────────────┐     ┌─────────────┐│  │
│  │ │ users       │     │ workflows   │     │ agent_inst  ││  │
│  │ │ ─────────   │     │ ─────────   │     │ ──────────  ││  │
│  │ │ _id         │◄────│ userId (FK) │     │ workflowId  ││  │
│  │ │ email       │     │ isDefault   │     │             ││  │
│  │ │ defaultWfId │────►│ isActive    │     └─────────────┘  │
│  │ │ workflowCnt │     │ name        │                      │
│  │ │             │     │ canvasState │     ┌─────────────┐  │
│  │ └─────────────┘     └─────────────┘     │ workflow_   │  │
│  │                                         │ nodes_v2    │  │
│  │                                         │ ─────────   │  │
│  │                                         │ workflowId  │  │
│  │                                         │ position    │  │
│  │                                         └─────────────┘  │
│  │                                                           │
│  │ Indexes:                                                │  │
│  │ ┌────────────────────────────────────────────────────┐│  │
│  │ │ workflows: { userId: 1, isDefault: 1 }      UNIQUE ││  │
│  │ │ workflows: { userId: 1, createdAt: -1 }           ││  │
│  │ │ workflows: { userId: 1, isActive: 1 }            ││  │
│  │ │ users: { email: 1, defaultWorkflowId: 1 }         ││  │
│  │ └────────────────────────────────────────────────────┘│  │
│  │                                                           │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔄 WORKFLOW STATE MANAGEMENT (Frontend to Backend)

### **User Session Flow:**

```
1. REGISTRATION
   ├─ User enters email/password
   ├─ POST /api/auth/register
   ├─ Backend creates User + default Workflow atomically ✅
   ├─ Response: { user, accessToken, refreshToken }
   └─ Frontend stores token + initializes UI

2. AUTHENTICATION
   ├─ POST /api/auth/login
   ├─ GET /api/workflows (fetch all user's workflows)
   ├─ Zustand store: workflows = [...]
   └─ Display list in sidebar

3. SELECT WORKFLOW
   ├─ User clicks workflow card
   ├─ POST /api/workflows/{id}/select
   ├─ Backend:
   │  ├─ Atomically disable other workflows
   │  ├─ Atomically enable this workflow
   │  ├─ Fetch agents + nodes + edges
   │  ├─ Return reloadedData
   │  └─ Transaction guarantees consistency
   ├─ Frontend:
   │  ├─ Store: currentWorkflowId = id
   │  ├─ Hydrate: agents, nodes, edges from reloadedData
   │  ├─ Reset runtime store (messages, execution state)
   │  └─ Render canvas with new data
   └─ UI shows active workflow

4. DISPLAY STATS
   ├─ User hovers/clicks workflow card
   ├─ GET /api/workflows/{id}/stats (optional lazy load)
   ├─ Display: agentCount, nodeCount, creation date
   └─ Show in workflow card component

5. DELETE WORKFLOW
   ├─ User clicks delete button
   ├─ Confirm dialog (if last workflow → show error)
   ├─ DELETE /api/workflows/{id}
   ├─ Backend:
   │  ├─ Check: otherWorkflows.count > 0
   │  ├─ If yes: proceed with cascade delete
   │  ├─ If no: return 400 LAST_WORKFLOW error
   │  ├─ Cascade:
   │  │  ├─ Delete agents
   │  │  ├─ Delete nodes
   │  │  ├─ Delete edges
   │  │  ├─ Delete journals
   │  │  ├─ Delete workflow
   │  │  └─ Reassign User.defaultWorkflowId if needed
   │  └─ Return success + cascade counts
   ├─ Frontend:
   │  ├─ Remove from workflows list
   │  ├─ Refresh UI
   │  └─ Show toast notification
   └─ List updated

6. CREATE WORKFLOW
   ├─ User clicks "New Workflow"
   ├─ Modal: enter name, optional description
   ├─ POST /api/workflows { name, description }
   ├─ Response: new Workflow object
   ├─ Frontend:
   │  ├─ Add to workflows list
   │  ├─ Show in sidebar
   │  └─ Close modal
   └─ Selection remains on current active workflow
```

---

## 💾 DATA CONSISTENCY GUARANTEES

### **Atomicity via MongoDB Transactions**

```typescript
// Pattern used in DELETE /api/workflows/:id
const session = await mongoose.startSession();
session.startTransaction();

try {
  // ALL OR NOTHING principle:
  // If ANY operation fails, ENTIRE transaction rolls back
  
  await Workflow.deleteOne({...}, { session });
  await AgentInstance.deleteMany({...}, { session });
  await WorkflowNodeV2.deleteMany({...}, { session });
  await WorkflowEdgeV2.deleteMany({...}, { session });
  await AgentJournal.deleteMany({...}, { session });
  
  // Update User reference
  await User.findByIdAndUpdate({...}, { session });
  
  await session.commitTransaction();
} catch (error) {
  // If ANY operation fails OR validation error:
  await session.abortTransaction();
  throw error;
}
```

**Invariants Maintained:**
1. ✅ No orphaned agents (always linked to workflow)
2. ✅ User has ≥1 workflow (last delete prevented)
3. ✅ defaultWorkflowId always valid (reassigned on delete)
4. ✅ workflowCount accurate (incremented/decremented atomically)

---

## 🔐 AUTHORIZATION & SECURITY

```typescript
// All endpoints use this pattern:
router.post('/workflows/:id/action',
  requireAuth,                    // ✅ JWT validation
  requireOwnershipAsync(async (req) => {
    const workflow = await Workflow.findById(req.params.id);
    return workflow?.userId.toString();  // ✅ Return owner ID
  }),
  async (req, res) => {
    // ✅ Will reject if current user != workflow owner
    // ✅ Will reject if workflow not found
  }
);
```

**Layers of Protection:**
1. **Authentication:** requireAuth checks JWT token validity
2. **Ownership:** requireOwnershipAsync verifies user owns resource
3. **Input Validation:** Zod schemas validate request body
4. **SQL Injection Prevention:** Mongoose parameterized queries (ObjectId checks)
5. **Authorization:** Field-level (users can't see other users' workflows)

---

## 📊 API RESPONSE CONTRACTS

### **Success Responses (200s)**

```json
// POST /api/workflows
{
  "_id": "mongoId",
  "userId": "mongoId",
  "name": "string",
  "description": "string",
  "isDefault": boolean,
  "isActive": boolean,
  "canvasState": { "zoom": 1, "panX": 0, "panY": 0 },
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601"
}

// POST /api/workflows/:id/select
{
  "success": true,
  "workflow": {...},
  "reloadedData": {
    "agents": [...],
    "nodes": [...],
    "edges": [...],
    "canvasState": {...}
  }
}

// GET /api/workflows/:id/stats
{
  "_id": "mongoId",
  "name": "string",
  "description": "string",
  "isActive": boolean,
  "isDefault": boolean,
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601",
  "agentInstanceCount": number,
  "nodeCount": number
}

// DELETE /api/workflows/:id
{
  "success": true,
  "deletedWorkflowId": "mongoId",
  "cascade": {
    "agentsDeleted": number,
    "edgesDeleted": number,
    "nodesDeleted": number,
    "journalsDeleted": number
  }
}
```

### **Error Responses (4xx/5xx)**

```json
// 400 Bad Request
{
  "error": "Impossible de supprimer le seul workflow",
  "code": "LAST_WORKFLOW",
  "message": "Chaque utilisateur doit avoir au moins un workflow"
}

// 401 Unauthorized
{
  "error": "Access denied: workflow belongs to another user",
  "errorCode": "NOT_OWNER"
}

// 404 Not Found
{
  "error": "Workflow introuvable"
}

// 500 Internal Server Error
{
  "error": "Erreur lors de l'activation du workflow",
  "details": "MongoDB connection timeout"
}
```

---

## 📦 Migration Checklist for Phase 2

**Before Frontend Development:**
- ✅ Read this document (you are here)
- ✅ Study API response contracts above
- ✅ Run integration tests locally (verify endpoints work)
- ✅ Import Postman collection (for quick testing)

**During Frontend Development:**
- ✅ Use `reloadedData` from `/select` to hydrate stores
- ✅ Handle error code `LAST_WORKFLOW` gracefully (show warning)
- ✅ Display workflow stats in UI (lazy load on demand)
- ✅ Implement optimistic updates (local state before API response)
- ✅ Test with multiple workflows (>2 for good coverage)

**After Frontend Completion:**
- ✅ Run end-to-end scenario tests
- ✅ Verify data sync between frontend & backend
- ✅ Test error scenarios (delete last workflow, auth failures)
- ✅ Performance validation (API response time <500ms)

---

## 🚨 KNOWN LIMITATIONS & FUTURE ENHANCEMENTS

### **Phase 1 (Current):**
- ✅ Create/Select/Delete workflows
- ✅ Atomic cascade deletes
- ✅ User ownership validation
- ✅ Default workflow enforcement

### **Phase 2 Planned:**
- 📋 Workflow favorites/pinning
- 📋 Workflow sharing with team members
- 📋 Workflow versioning/history
- 📋 Workflow templates
- 📋 Batch operations (delete multiple)
- 📋 Export/import workflows

### **Known Constraints:**
- ⚠️ Single MongoDB transaction timeout: 60 seconds (workflows <10K items OK)
- ⚠️ No soft deletes (hard delete only)
- ⚠️ No audit trail yet (timestamps only)

---

## 🔍 DEBUGGING TROUBLESHOOTING

### **Problem: "Cannot delete last workflow"**
```
Solution: This is intentional! Users must have ≥1 workflow.
Create second workflow first, then delete the first one.
```

### **Problem: defaultWorkflowId not updated**
```
Solution: Check backend logs for transaction rollbacks.
Likely cause: User model validation failed.
Fix: Ensure User exists before updating defaultWorkflowId.
```

### **Problem: reloadedData is empty array**
```
Solution: Workflow exists but has no agents/nodes yet.
This is normal for a new workflow!
Frontend should handle empty arrays gracefully.
```

### **Problem: 401 error on workflow delete**
```
Solution: Token expired or user changed.
Fix: Refresh auth token before making request.
```

---

## 📚 RESOURCES FOR PHASE 2

1. **API Documentation**: Use PHASE1_TESTING_GUIDE.md (cURL examples)
2. **Postman Collection**: [Link to be created by QA team]
3. **Database Schema**: (See earlier mongo-db/
4. **Architecture Diagram**: See above (VUE GLOBALE section)
5. **Type Definitions**: `backend/src/models/{Workflow,User}.model.ts`

---

## 💬 SUPPORT & HANDOFF

**Questions about Phase 1 Implementation?**
- Architecture: Review ARCHITECTURE GUIDE in Guides/
- API Contracts: Review API responses above
- Tests: Run `npm run test` in backend/

**Ready to Start Phase 2?**
- ✅ All tests passing
- ✅ Backend running
- ✅ API endpoints stable
- ✅ Documentation complete
- ☑️ Frontend team ready to start

---

**Signature:** ARC-1 (Architect IA)  
**Date:** Février 2026  
**Status:** ✅ PRODUCTION READY - Phase 2 Can Commence

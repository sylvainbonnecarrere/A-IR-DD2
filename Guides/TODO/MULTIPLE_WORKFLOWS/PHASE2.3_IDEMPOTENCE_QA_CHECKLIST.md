# PHASE 2.3 - QA Checklist: Idempotence Fix

## 📋 Test Case: Legacy User Account
- **User**: test@test.fr
- **Expected State Pre-Login**:
  - ✅ User document exists with `workflowCount: 0`
  - ✅ Workflow document EXISTS with `userId: ObjectId("6972b7dac937c94b675d0e38")`
  - ❌ User.defaultWorkflowId is NULL (legacy)
  - ✅ Workflow has `1 agent instance` (from Phase 1)

---

## 🔍 Test Sequence

### **STEP 1: Check MongoDB Pre-State**
```bash
# Terminal: MongoDB Compass or mongo shell
db.users.findOne({ email: "test@test.fr" })
# Expected: { defaultWorkflowId: null, workflowCount: 0 }

db.workflows.findOne({ userId: ObjectId("6972b7dac937c94b675d0e38") })
# Expected: { _id: ..., userId: ..., isActive: true, isDefault: true }

db.agentinstances.count({ userId: ObjectId("6972b7dac937c94b675d0e38") })
# Expected: >= 1
```

---

### **STEP 2: Frontend Login**
```
1. Open browser http://localhost:5173
2. Logout any current session
3. Login with test@test.fr
4. WATCH FOR:
   - Browser console: [BosWorkflows] logs
   - User redirected to dashboard
   - Workflows loaded in background
```

**EXPECTED CONSOLE LOGS** (in order):
```
✅ [Auth] User logged in: test@test.fr
✅ [App] Workflows loaded successfully
   OR if empty initially:
   [Workflows] Attempting GET /api/workflows
   [Workflows] Found 0 workflows for user ...
   [Workflows] No workflows found, triggering auto-migration
   [Workflows] AUTO-PROMOTION: Using existing workflow ...
```

---

### **STEP 3: Navigate to /bos/workflows/manage**
```
1. Click "BOS" robot
2. Click "Manage Workflows" menu item
3. WATCH FOR:
   - [BosWorkflows] logs in browser console
   - Page renders without error
   - "Mon Workflow" card visible
   - 1 agent instance shown
```

**EXPECTED CONSOLE**:
```
✅ [BosWorkflows] Component starting workflow load
✅ [BosWorkflows] Calling loadUserWorkflows()
✅ [BosWorkflows] ✅ loadUserWorkflows() completed
✅ [BosWorkflows] Component render - state: { workflowsCount: 1, ... }
```

**EXPECTED UI**:
- ✅ Header: "Gérer les workflows"
- ✅ Create button visible
- ✅ 1 workflow card ("Mon Workflow")
- ✅ No error messages
- ✅ No "utilisateur non authentifié"

---

### **STEP 4: Check MongoDB Post-State**
```bash
# Terminal: MongoDB
db.users.findOne({ email: "test@test.fr" })
# Expected: { 
#   defaultWorkflowId: ObjectId("6972b7dac937c94b675d0e3b"),  # ✅ NOW SET!
#   workflowCount: 1,  # ✅ NOW SET!
#   lastActiveWorkflowId: ObjectId("6972b7dac937c94b675d0e3b")
# }
```

---

## 🚨 If Test Fails: Debugging Steps

### **Symptom: "utilisateur non authentifié" error displayed**
```
1. Check: isAuthenticated=true in debug text?
   - If TRUE: browser console [BosWorkflows] logs?
     - If NO logs: loadUserWorkflows() never called
       → Check App.tsx useEffect with isAuthenticated
     - If logs BUT error: Check network tab for 401/500
   - If FALSE: Check AuthContext - why not authenticated after login?
```

### **Symptom: No workflows displayed**
```
1. Browser console:
   - Search: [Workflows]
   - Should see: "Attempting GET /api/workflows"
   - Should see: Response status code
   - If 404/401: Backend endpoint might be broken
   - If 200 but empty: Check MongoDB query (ObjectId issue?)

2. Backend logs (while page loads):
   - Should see: [Workflows] GET - userId: ...
   - Should see: [Workflows] Found X workflows
   - If empty → auto-migration logs
   - If errors: Check logs above
```

### **Symptom: Backend logs show no /api/workflows call**
```
1. Frontend might be stopping BEFORE the API call
   - Check: is loadUserWorkflows() in App.tsx running?
   - Check: BosWorkflowManagementPage useEffect firing?
   - Add console.log to verify execution path

2. Or endpoint returning 500:
   - Check backend logs for errors
   - Check MongoDB connection
   - Check User.updateOne() call
```

---

## ✅ Success Criteria

| Metric | Target |
|--------|--------|
| Workflow visible on page | ✅ 1 workflow displayed |
| No auth error | ✅ Real error or empty state |
| MongoDB User updated | ✅ defaultWorkflowId SET |
| Browser console clean | ✅ No unexpected errors |
| API call traced | ✅ [Workflows] logs show flow |
| Agent instance visible | ✅ Still accessible in workflow |

---

## 📝 Logging Map

```
Browser Console:
  [App]           - App lifecycle
  [Auth]          - Authentication (from backend via logs)  
  [Workflows]     - Store action logs
  [BosWorkflows]  - Component-specific logs

Backend Console:
  [Workflows]     - Route endpoint logs
  [LLMProxy]      - Auth token verification
```

---

## 🔧 Quick Commands

```bash
# 1. Reset user for re-testing (if needed)
db.users.updateOne(
  { email: "test@test.fr" },
  { $unset: { defaultWorkflowId: "", workflowCount: 0 } }
)

# 2. View all user workflows
db.workflows.find({ userId: ObjectId("6972b7dac937c94b675d0e38") })

# 3. Restart backend with fresh logs
cd backend
npm run dev
```

---

## 🎯 Expected Behavior After Fix

### Before Fix (❌ BROKEN):
```
Login → /api/user/workspace works ✅
     → /api/workflows returns 0 workflows ❌
     → BosWorkflowManagementPage shows "not authenticated" ❌
```

### After Fix (✅ FIXED):
```
Login → /api/user/workspace works ✅  
     → /api/workflows finds workflow ✅
     → Auto-updates User.defaultWorkflowId ✅
     → BosWorkflowManagementPage shows workflow ✅
     → MongoDB User record sync'ed ✅
```

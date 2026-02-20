# 🧪 GUIDE EXÉCUTION PHASE 1 - TESTS & VALIDATION

**Status:** Phase 1 Implémentation Terminée  
**Objectif:** Valider que tout fonctionne sans régression  

---

## 📋 CHECKLIST PRÉ-DÉPLOIEMENT

### 1. Build & Compilation ✅

```bash
# Backend TypeScript compilation
cd backend
npm run build
# Expected: 0 errors

# Frontend Vite build
cd ..
npm run build
# Expected: Success (chunk size warning non-critique)
```

### 2. Tests Unitaires ✅

```bash
# Position: /backend
npm run test -- __tests__/workflows.unit.test.ts --verbose

# Expected Tests:
✅ Workflows Unit Tests - Phase 1
  ✅ 1. Workflow Creation (first, subsequent)
  ✅ 2. User Model Extensions
  ✅ 3. Workflow Indexes
  ✅ 4. Workflow Validation
  ✅ 5. Workflow Queries

# Coverage: 18+ test cases
```

### 3. Tests d'Intégration ✅

```bash
# Position: /backend
npm run test -- __tests__/workflows.integration.test.ts --verbose

# Expected Tests:
✅ 📡 Workflows Integration Tests - Phase 1
  ✅ 1. User Registration & Workflow Creation
  ✅ 2. POST /api/workflows - Create Workflow
  ✅ 3. POST /api/workflows/:id/select - Activate Workflow
  ✅ 4. GET /api/workflows/:id/stats - Get Workflow Stats
  ✅ 5. DELETE /api/workflows/:id - Delete Workflow
  ✅ 6. Authorization & Ownership

# Coverage: 20+ test cases
# Duration: ~30-60 seconds
```

---

## 🚀 DÉMARRAGE LOCAL

### Terminal 1: Backend
```bash
cd backend
npm install  # Si première fois
npm run dev
# Expected console output:
# ✅ MongoDB connected
# ✅ Server running on http://localhost:3001
# ✅ [Workflows] Routes registered
```

### Terminal 2: Frontend
```bash
npm run dev
# Expected console output:
# ✅ VITE v6.4.1 ready in 123 ms
# ➜  Local:   http://localhost:5173
```

---

## 🔍 VALIDATION MANUELLE VIA cURL

### 1. Registration (Créer Utilisateur + Default Workflow)
```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "TestPassword123"
  }'

# Expected Response:
# {
#   "user": { "id": "...", "email": "test@example.com" },
#   "accessToken": "eyJhbGc...",
#   "refreshToken": "..."
# }

# Save accessToken for next steps
export TOKEN="eyJhbGc..."
```

### 2. List Workflows
```bash
curl http://localhost:3001/api/workflows \
  -H "Authorization: Bearer $TOKEN"

# Expected Response: Array avec 1 workflow (le default)
# [
#   {
#     "_id": "...",
#     "name": "Mon Workflow",
#     "isDefault": true,
#     "isActive": true,
#     "agentCount": 0,
#     "userId": "..."
#   }
# ]
```

### 3. Create Second Workflow
```bash
curl -X POST http://localhost:3001/api/workflows \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Second Workflow",
    "description": "Test workflow"
  }'

# Expected Response:
# {
#   "_id": "workflow2id",
#   "name": "My Second Workflow",
#   "isDefault": false,
#   "isActive": false
# }

# Save _id for next tests
export WF2_ID="workflow2id"
```

### 4. Get Workflow Stats
```bash
curl http://localhost:3001/api/workflows/$WF2_ID/stats \
  -H "Authorization: Bearer $TOKEN"

# Expected Response:
# {
#   "_id": "workflow2id",
#   "name": "My Second Workflow",
#   "agentInstanceCount": 0,
#   "nodeCount": 0,
#   "createdAt": "2026-02-19T...",
#   "isDefault": false,
#   "isActive": false
# }
```

### 5. Select (Activate) Workflow
```bash
curl -X POST http://localhost:3001/api/workflows/$WF2_ID/select \
  -H "Authorization: Bearer $TOKEN"

# Expected Response:
# {
#   "success": true,
#   "workflow": {
#     "isActive": true,
#     "isDefault": false
#   },
#   "reloadedData": {
#     "agents": [],
#     "nodes": [],
#     "edges": [],
#     "canvasState": { "zoom": 1, "panX": 0, "panY": 0 }
#   }
# }
```

### 6. Verify First Workflow Deactivated
```bash
curl http://localhost:3001/api/workflows \
  -H "Authorization: Bearer $TOKEN"

# Expected: First workflow now has isActive: false
# [
#   { "_id": "...", "isActive": false, "name": "Mon Workflow" },
#   { "_id": "workflow2id", "isActive": true, "name": "My Second Workflow" }
# ]
```

### 7. Delete Second Workflow
```bash
curl -X DELETE http://localhost:3001/api/workflows/$WF2_ID \
  -H "Authorization: Bearer $TOKEN"

# Expected Response:
# {
#   "success": true,
#   "deletedWorkflowId": "workflow2id",
#   "cascade": {
#     "agentsDeleted": 0,
#     "edgesDeleted": 0,
#     "nodesDeleted": 0,
#     "journalsDeleted": 0
#   }
# }
```

### 8. Verify Default Workflow Reassigned
```bash
# Query user to verify defaultWorkflowId
# Expected: First workflow is now default again

curl http://localhost:3001/api/workflows \
  -H "Authorization: Bearer $TOKEN"

# Should show only 1 workflow (first one)
# with isDefault: true
```

### 9. Try Delete Last Workflow (SHOULD FAIL)
```bash
curl -X DELETE http://localhost:3001/api/workflows/firstworkflowid \
  -H "Authorization: Bearer $TOKEN"

# Expected Response (400):
# {
#   "error": "Impossible de supprimer le seul workflow",
#   "code": "LAST_WORKFLOW"
# }
```

---

## ✅ REGRESSION TESTS

### Si Workflows Existants Fonctionnaient Avant, Ils Doivent Marcher Après

```bash
# Tester endpoints existants:

# 1. GET /api/workflows (était existant)
curl http://localhost:3001/api/workflows \
  -H "Authorization: Bearer $TOKEN"
# Expected: toujours fonctionnel

# 2. PUT /api/workflows/:id (mise à jour)
curl -X PUT http://localhost:3001/api/workflows/<id> \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Updated Name" }'
# Expected: fonctionne

# 3. POST /api/workflows/:id/save
curl -X POST http://localhost:3001/api/workflows/<id>/save \
  -H "Authorization: Bearer $TOKEN"
# Expected: fonctionne
```

---

## 📊 LOGS À SURVEILLER

### Backend Console
```
[Workflows] POST - existingCount: 0
[Workflows] POST - User updated with defaultWorkflowId: { userId: "...", workflowId: "..." }
[Workflows] SELECT - Workflow activated: { userId: "...", workflowId: "...", agentsCount: 0 }
[Workflows] DELETE - Reassigned defaultWorkflowId: { userId: "...", deletedWorkflowId: "...", newDefaultWorkflowId: "..." }
```

### MongoDB
```bash
# Vérifier collections après tests
mongosh

# Connect to test DB
use irdd-test

# Verify workflows
db.workflows.find().pretty()

# Verify user has correct defaultWorkflowId
db.users.findOne({ email: "test@example.com" }, { defaultWorkflowId: 1, workflowCount: 1 }).pretty()
```

---

## 🐛 DEBUGGING TIPS

### Si tests échouent:

1. **Check MongoDB connection:**
   ```bash
   mongosh
   show databases
   use irdd-test
   ```

2. **Check test isolation:**
   - Confirm `beforeEach` cleans collections
   - Random email per test: `email: \`test-\${Date.now()}@example.com\``

3. **Check async/await:**
   - Tous les `it()` doivent être `async`
   - Tous les `expect()` après opérations async

4. **Token issues:**
   ```bash
   # Vérify token format
   echo $TOKEN | base64 -d
   # Should see: `{"sub":"...", "email":"..."}`
   ```

---

## ✨ QUICK WINS FOR QA

- ✅ **Zero console errors** in backend/frontend
- ✅ **All 38+ tests pass** (18 unit + 20 integration)
- ✅ **Endpoints respond in <100ms** (check network tab)
- ✅ **Database clean after tests** (no lingering data)
- ✅ **Auth tokens valid** (JWT parsing successful)
- ✅ **CORS working** (cross-origin requests allowed)

---

## 🚀 READY FOR PHASE 2

**Notify Frontend Team When:**
- ✅ All tests green
- ✅ Backend running on http://localhost:3001
- ✅ Endpoints responding correctly
- ✅ API documentation finalized (use this guide + Postman collection)

**Next Phase Goals:**
- Create `BosWorkflowManagementPage.tsx`
- Create `WorkflowCard.tsx` component
- Update `useDesignStore` with workflow state
- Add i18n translations (25+ keys)
- Create responsive UI/UX

---

**Timeline:** ~3-4 days (Phase 2 Frontend Implementation)  
**Team:** Frontend Specialist + Designer  
**Starting Point:** API contracts are FROZEN and STABLE ✅

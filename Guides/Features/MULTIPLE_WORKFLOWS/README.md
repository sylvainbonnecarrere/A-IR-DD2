# MULTIPLE WORKFLOWS FEATURE - Complete Implementation Plan

**Status**: 📋 Ready for Developer Handoff  
**Last Updated**: 2024  
**Phases**: 3 (Backend, Frontend, Testing & Polish)  

---

## 📚 Documentation Map

This directory contains comprehensive guides for implementing the **Multiple Workflows** feature across all layers (Database, API, Frontend, i18n, Testing, Design).

### Phase 1: Backend ✅ Complete
**File**: [PHASE1_BACKEND.md](PHASE1_BACKEND.md)

**Duration**: 3-4 days  
**Team**: mongo-persistance, Backend Specialist  

**Deliverables**:
1. ✅ Extend User model with `defaultWorkflowId`
2. ✅ Verify Workflow model schema (isDefault, isActive, timestamps)
3. ✅ Design cascade delete transaction strategy
4. ✅ Implement 5 new API endpoints:
   - `POST /api/workflows` - Create workflow
   - `GET /api/workflows` - List user workflows
   - `GET /api/workflows/:id/stats` - Get agent/node counts
   - `POST /api/workflows/:id/select` - Switch active workflow + reload data
   - `DELETE /api/workflows/:id` - Delete with cascade + atomicity
5. ✅ Add MongoDB indexes for performance
6. ✅ Create unit & integration tests
7. ✅ Verify no data loss on cascade delete

**Key Files to Modify**:
- `backend/src/models/User.model.ts` - Add defaultWorkflowId field
- `backend/src/models/Workflow.model.ts` - Verify schema
- `backend/src/routes/workflows.routes.ts` - Add 5 endpoints
- `backend/src/controllers/workflowController.ts` - Implement business logic
- `backend/src/services/workflowService.ts` - Cascade delete transactions

---

### Phase 2: Frontend ✅ Complete
**File**: [PHASE2_FRONTEND.md](PHASE2_FRONTEND.md)

**Duration**: 3-4 days  
**Team**: Frontend Specialist, Designer UX  

**Deliverables**:
1. ✅ Extend useDesignStore with workflow management actions
2. ✅ Create 3 new React components:
   - `BosWorkflowManagementPage` - Main management page for BOS robot
   - `WorkflowCard` - Individual workflow display (with stats, actions)
   - `CreerWorkflowDialog` - Create new workflow modal
3. ✅ Update routing (RobotPageRouter, BosSubMenu)
4. ✅ Integrate with App.tsx (workflow loading on auth)
5. ✅ Reset runtime store on workflow switch
6. ✅ Add 25+ i18n translation keys (placeholder)
7. ✅ Create unit & component tests
8. ✅ Apply BOS yellow/gold theme + cosmic aesthetic

**Key Files to Create**:
- `components/BosWorkflowManagementPage.tsx` - NEW
- `components/workflow/WorkflowCard.tsx` - NEW
- `components/modals/CreerWorkflowDialog.tsx` - NEW

**Key Files to Modify**:
- `stores/useDesignStore.ts` - Add workflow state & actions
- `components/RobotPageRouter.tsx` - Add routing condition
- `data/robotNavigation.ts` - Add BOS menu item
- `App.tsx` - Load workflows on auth
- `i18n/*.ts` - Add translation keys (all 6 languages)

---

### Phase 3: Testing, i18n & Polish ✅ Complete
**File**: [PHASE3_POLISH.md](PHASE3_POLISH.md)

**Duration**: 2-3 days  
**Team**: QA, i18n Team, Designer UX  

**Deliverables**:
1. ✅ Complete i18n translations (FR, EN, DE, ES, PT, UA)
2. ✅ Design & styling polish (BOS theme consistency, responsive, animations)
3. ✅ End-to-end testing (create/select/delete workflows)
4. ✅ Regression testing (verify no existing features broken)
5. ✅ Performance testing (render time, cascade delete)
6. ✅ UAT scenarios (5 complete user workflows)
7. ✅ Browser & device testing
8. ✅ Documentation updates (Architecture, README, Deployment)
9. ✅ Accessibility compliance (a11y)

**Key Testing Areas**:
- ✅ User signup → default workflow creation
- ✅ Workflow CRUD operations
- ✅ Cascade delete atomicity
- ✅ Guest user demo mode
- ✅ Multi-language support
- ✅ Responsive layout (desktop/tablet/mobile)
- ✅ Error handling & validation
- ✅ Performance benchmarks

**Key Documentation to Update**:
- `Guides/ARCHITECTURE_GUIDE.md` - Add multi-workflow section
- `README.md` - List new feature
- `Guides/DEPLOYMENT_MULTIPLE_WORKFLOWS.md` - Deployment checklist (NEW)

---

## 🎯 Feature Overview

### User-Facing Behavior

**Authenticated Users**:
1. **On Signup**: Automatically created 1 default workflow "My First Workflow"
2. **BOS Menu**: New item "Manage Workflows" (yellow icon with glow)
3. **Workflow Management Page**:
   - Grid of workflow cards (3 columns on desktop, 2 on tablet, 1 on mobile)
   - Each card shows:
     - ✅ Workflow name
     - ✅ Description (if any)
     - ✅ Created date (FR date format)
     - ✅ Modified date
     - ✅ Agent count
     - ✅ Node count
     - ✅ "Select" button (enables workflow, reloads canvas)
     - ✅ "Delete" button (if not default, with confirmation dialog)
     - ✅ ⭐ Badge if default workflow
   - Top-right button: "✨ Create New Workflow"
4. **Create Workflow Dialog**:
   - Name field (required)
   - Description field (optional)
   - Create button (disabled if name empty)
   - Cancel button
5. **Delete Confirmation**:
   - "Are you sure? This will delete the workflow and ALL its contents (agents, notes, logs). This action cannot be undone."
   - Prevents accidental deletion
   - Prevents deleting only remaining workflow
   - Prevents deleting default workflow
6. **Workflow Switch**:
   - Click "Select" on any card → full page reload with new workflow data
   - Chat history cleared (new runtime context)
   - Canvas shows agents from selected workflow
   - Smooth transition with loading animation

**Guest Users**:
- Navigate to BOS → "Manage Workflows" shows:
  - "👤 Guest User - Demo Workflow"
  - "Sign in to manage multiple workflows"
  - No create/delete buttons
  - Demo workflow appears in main canvas

---

## 🏗️ Architecture Impact

### Domain Boundaries Maintained ✅

**Design Domain** (Static):
- Workflow definitions (name, description, timestamps)
- Agent prototypes & instances
- Canvas nodes & edges
- Creator permissions

**Runtime Domain** (Dynamic):
- Chat messages (cleared on workflow switch)
- Execution state & streaming
- WebSocket connections (reset)
- Performance metrics

**Template Domain** (Shared):
- Workflow.ts and other templates
- NOT scoped per workflow
- Available to all workflows

### Database Schema

**New/Modified Collections**:
- `users` - ADD `defaultWorkflowId` (UUID)
- `workflows` - VERIFY schema (isDefault, isActive, timestamps)
- Cascade relationships:
  - Agent Instance → Workflow
  - Workflow Node → Workflow
  - Workflow Edge → Workflow
  - Agent Journal → Workflow

**Indexes Required**:
```javascript
db.agentinstances.createIndex({workflowId: 1})
db.workflownodes.createIndex({workflowId: 1})
db.workflowedges.createIndex({workflowId: 1})
db.agentjournals.createIndex({workflowId: 1})
db.workflows.createIndex({userId: 1, isDefault: 1})
```

### API Contract

```
POST /api/workflows
  Create new workflow
  Input: {name: string, description?: string}
  Output: {_id, name, description, isDefault: false, isActive: false, createdAt, updatedAt, userId}

GET /api/workflows
  List all user workflows
  Input: Auth header
  Output: [{_id, name, description, isDefault, isActive, createdAt, updatedAt}, ...]

GET /api/workflows/:id/stats
  Get workflow statistics
  Input: workflowId
  Output: {agentInstanceCount: number, nodeCount: number}

POST /api/workflows/:id/select
  Switch active workflow + reload full data
  Input: workflowId
  Output: {workflow: {...}, reloadedData: {agents: [], nodes: [], edges: []}}

DELETE /api/workflows/:id
  Delete workflow with cascade
  Input: workflowId
  Output: {success: true, message: "Workflow deleted"}
  Error: Cannot delete last workflow / cannot delete default / not owner
```

---

## 📊 Implementation Checklist

### ✅ Phase 1: Backend
- [ ] User model extended
- [ ] Workflow model verified
- [ ] 5 API endpoints implemented
- [ ] Cascade delete transactions tested
- [ ] MongoDB indexes created
- [ ] Unit tests passing
- [ ] Integration tests passing
- [ ] Performance OK (<500ms per operation)

### ✅ Phase 2: Frontend
- [ ] useDesignStore extended
- [ ] 3 new components created (BosWorkflowManagementPage, WorkflowCard, CreerWorkflowDialog)
- [ ] RobotPageRouter updated
- [ ] App.tsx integrated
- [ ] Runtime store reset on switch
- [ ] BOS navigation updated
- [ ] Component tests passing
- [ ] Styling applied (BOS theme)

### ✅ Phase 3: Polish
- [ ] i18n keys added (all 6 languages)
- [ ] Design system consistency verified
- [ ] Responsive layout tested
- [ ] Animations smooth
- [ ] Accessibility compliant
- [ ] End-to-end tests passing
- [ ] Regression tests passing
- [ ] Performance benchmarks OK
- [ ] UAT scenarios validated
- [ ] Documentation updated

---

## 🚀 Developer Handoff Instructions

### For Backend Developer (Period 1)

1. **START**: Read [PHASE1_BACKEND.md](PHASE1_BACKEND.md)
2. **DO**: Follow task-by-task backend implementation guide
3. **TEST**: Run unit + integration test templates provided
4. **VERIFY**: Cascade delete atomicity with transaction simulation
5. **DELIVER**: All 5 endpoints working, tests passing, API contracts met
6. **TIME**: 3-4 days

**Success Criteria**:
- All 5 endpoints respond correctly
- Cascade delete removes all child records atomically
- Stats endpoint returns accurate counts
- Performance < 500ms per operation
- 100% test coverage for new code

---

### For Frontend Developer (Period 2 - Depends on Phase 1)

1. **START**: Read [PHASE2_FRONTEND.md](PHASE2_FRONTEND.md)
2. **DO**: Follow component-by-component frontend implementation
3. **INTEGRATE**: Store actions, routing, App.tsx
4. **TEST**: Run component + unit tests provided
5. **STYLE**: Apply BOS yellow/gold theme & cosmic aesthetic
6. **DELIVER**: All components rendering, store working, routing functional
7. **TIME**: 3-4 days

**Success Criteria**:
- BosWorkflowManagementPage renders correctly
- All store actions working (create/select/delete)
- Routing to /bos/workflows/manage works
- Guest mode shows correct message
- Component tests passing
- No console errors

---

### For QA & i18n Team (Period 3 - Depends on Phase 1 & 2)

1. **START**: Read [PHASE3_POLISH.md](PHASE3_POLISH.md)
2. **DO**: Complete i18n translations (all 6 languages)
3. **TEST**: Run E2E + regression test scenarios
4. **POLISH**: Design/styling consistency, animations, accessibility
5. **VALIDATE**: UAT scenarios with real users
6. **DELIVER**: All tests passing, documentation updated, ready for production
7. **TIME**: 2-3 days

**Success Criteria**:
- All i18n keys translated
- E2E tests passing (create/select/delete)
- No regression in existing features
- UAT scenarios validated
- Accessibility OK (WCAG 2.1 AA)
- Performance benchmarks met

---

## 🔐 Risk Mitigation

### Highest Risk Areas

**1. Cascade Delete Atomicity**
- ⚠️ RISK: Partial delete if transaction fails mid-operation
- ✅ MITIGATION: MongoDB transactions with rollback
- ✅ TEST: Simulate failures during cascade (see PHASE3)
- ✅ VERIFY: No orphaned records after failed delete

**2. Race Conditions**
- ⚠️ RISK: User clicks "Select" twice → duplicate loads
- ✅ MITIGATION: Debounce select action, show loading state
- ✅ TEST: Rapid-fire select operations

**3. Performance Degradation**
- ⚠️ RISK: Large workflow count (> 100) causes UI slowdown
- ✅ MITIGATION: Paginate workflows, lazy-load stats
- ✅ TEST: Render 1000 workflows, measure time

**4. Data Loss in Migration**
- ⚠️ RISK: Old users lose data during migration
- ✅ MITIGATION: Create default workflow for all existing users
- ✅ TEST: Dry-run migration on production replica first

**5. Default Workflow Deletion**
- ⚠️ RISK: User deletes default → cannot create new workflows
- ✅ MITIGATION: Backend prevents deleting default, UI shows ⭐ badge
- ✅ TEST: Try deleting default → expect 400/403 error

---

## 📱 Browser & Device Support

**Desktop (Primary Target - PC-only per design)**:
- ✅ Chrome 120+
- ✅ Firefox 121+
- ✅ Safari 17+
- ✅ Edge 121+

**Tablet (Secondary - responsive grid)**:
- ✅ iPad (2 column grid)
- ✅ Android tablets (2 column grid)

**Mobile (Show desktop-only message)**:
- ⚠️ iPhone - Show "Desktop only" message
- ⚠️ Android phones - Show "Desktop only" message

---

## 🌍 Internationalization

**Supported Languages**:
1. 🇫🇷 Français (FR)
2. 🇺🇸 English (EN)
3. 🇩🇪 Deutsch (DE)
4. 🇪🇸 Español (ES)
5. 🇵🇹 Português (PT)
6. 🇺🇦 Українська (UA)

**Translation Keys**: 25+ new keys (see PHASE3_POLISH.md for complete list)

**Date Formatting**: Per-language locale (e.g., DD/MM/YYYY for FR, MM/DD/YYYY for EN)

---

## 📖 Additional Resources

- **Database Diagrams**: See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md#database-schema)
- **API Reference**: See [PHASE1_BACKEND.md](PHASE1_BACKEND.md#api-endpoints)
- **Component Props**: See [PHASE2_FRONTEND.md](PHASE2_FRONTEND.md#component-props)
- **Test Templates**: See [PHASE3_POLISH.md](PHASE3_POLISH.md#test-templates)
- **Design System**: See Guides/UX/APP_DESIGN.md
- **Architecture**: See Guides/ARCHITECTURE_GUIDE.md

---

## 📞 Support & Questions

**For Backend Questions**: 
- Reference `PHASE1_BACKEND.md` - Task sections 1-5
- Check Workflow model schema in `backend/src/models/Workflow.model.ts`
- Review cascade delete transaction patterns in `backend/src/services/`

**For Frontend Questions**:
- Reference `PHASE2_FRONTEND.md` - Task sections 1-4
- Check store integration in `stores/useDesignStore.ts`
- Review component templates in sections 2.1-2.3

**For Testing/i18n Questions**:
- Reference `PHASE3_POLISH.md` - Task sections 1-5
- Check test templates in sections 3.1-3.4
- Review translation keys in section 1

---

## ✨ Feature Ready for Development

**All documentation prepared and organized for developer teams.**

**Next Step**: Assign developers to phases and begin implementation.

---

**Document Version**: 1.0  
**Created**: 2024  
**Status**: 🟢 Ready for Production Handoff

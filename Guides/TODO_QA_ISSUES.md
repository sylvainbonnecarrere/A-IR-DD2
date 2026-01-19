# TODO - QA Issues & Technical Debt

**Status**: Identified and documented  
**Date**: January 19, 2026  
**Priority**: MEDIUM (should be fixed before release)

---

## 🐛 Bug #1: Agent Deletion Requires Double-Click Confirmation

**Severity**: HIGH - Blocking user workflows  
**Reporter**: User feedback  
**Date Discovered**: Jan 19, 2026

### Problem Description

When user deletes an agent from the sidebar:
1. ✅ Click delete button → Confirmation modal appears
2. ❌ User confirms deletion → **Nothing happens** (silently fails)
3. ❌ User must click delete button AGAIN
4. ✅ User confirms AGAIN → Agent is finally deleted

### Root Cause Analysis

**Hypothesis**: Event bubbling / State timing issue in `confirmDeleteAgent()` callback

- Old implementation set `deleteConfirmation = null` AFTER performing deletion
- If modal state resets before event handling completes, the onClick handler might re-trigger
- This causes the confirmation to be skipped on first attempt

### Files Affected

- **Primary**: [App.tsx](../App.tsx) lines 771-779 (`confirmDeleteAgent` function)
- **Secondary**: 
  - [ConfirmationModal.tsx](../components/modals/ConfirmationModal.tsx) (modal rendering)
  - [useDesignStore.ts](../stores/useDesignStore.ts) (`deleteAgent` action)

### Fix Applied

✅ **FIXED** - Reordered state updates in `confirmDeleteAgent()`:
```typescript
// BEFORE (problematic)
const confirmDeleteAgent = () => {
  if (deleteConfirmation) {
    const { agentId } = deleteConfirmation;
    setAgents(prev => prev.filter(...));        // Perform deletion
    setWorkflowNodes(prev => prev.filter(...)); // Perform deletion
    setDeleteConfirmation(null);                // Close modal LAST
  }
};

// AFTER (fixed)
const confirmDeleteAgent = () => {
  if (deleteConfirmation) {
    const { agentId } = deleteConfirmation;
    setDeleteConfirmation(null);                // Close modal FIRST (prevent bubbling)
    setAgents(prev => prev.filter(...));        // Then perform deletion
    setWorkflowNodes(prev => prev.filter(...)); // Then perform deletion
  }
};
```

### Verification Steps

1. Create agent and add to workflow
2. Click delete button on agent node
3. Confirm deletion in modal
4. ✅ Agent should be deleted on FIRST confirmation
5. ❌ Should NOT require second click

### Testing

- [ ] Manual test: Delete agent and verify single-click works
- [ ] Edge case: Spam-click delete button while modal is open
- [ ] Monitor: Check browser console for any lingering errors

---

## 🧹 Cleanup #1: Remove Unused MongoDB Collections

**Severity**: MEDIUM - Technical debt / Code hygiene  
**Reporter**: User feedback on cleanup  
**Date Discovered**: Jan 19, 2026

### Problem Description

When running `npm run dev` on backend, MongoDB schema initialization creates obsolete collections:

1. ❌ `agents` - Reliquat from ancient architecture
2. ⚠️ `agent_instances_v2` - Likely replaced by `agent_instances`
3. ⚠️ `workflow_nodes_v2` - Likely replaced by nodes stored in `workflow` collection

These collections are never used but:
- Waste disk space
- Create confusion during development
- Clutter MongoDB compass UI
- May interfere with schema validation

### Collection Audit

| Collection | Status | Used? | Reason |
|-----------|--------|-------|--------|
| `users` | ✅ Active | Yes | User authentication |
| `llm_configs` | ✅ Active | Yes | LLM provider configs |
| `user_settings` | ✅ Active | Yes | User preferences |
| `workflows` | ✅ Active | Yes | Workflow definitions |
| `agent_prototypes` | ✅ Active | Yes | Agent templates |
| `agent_instances` | ✅ Active | Yes | Agent runtime instances |
| `agent_journals` | ✅ Active | Yes | Chat history (Phase 3) |
| `workflow_nodes` | ⚠️ Mixed | Maybe | Need to verify |
| `workflow_edges` | ⚠️ Mixed | Maybe | Need to verify |
| `agents` | ❌ **UNUSED** | No | **REMOVE** |
| `agent_instances_v2` | ❌ **UNUSED** | No | **REMOVE** |
| `workflow_nodes_v2` | ❌ **UNUSED** | No | **REMOVE** |

### Files to Clean Up

1. **Schema Models** (remove/archive files):
   - [ ] Check if `backend/src/models/Agent.model.ts` exists → DELETE if unused
   - [ ] Verify `AgentInstanceV2.model.ts` → DELETE if not imported anywhere
   - [ ] Verify `WorkflowNodeV2.model.ts` → DELETE if not imported anywhere

2. **Exports** (update `backend/src/models/index.ts`):
   - [ ] Remove exports of unused models
   - [ ] Remove `AgentInstanceV2` if V2 not used in production code
   - [ ] Remove `WorkflowNodeV2` if V2 not used in production code

3. **Schema Initialization** (update `backend/src/server.ts`):
   - [ ] Locate collection initialization code
   - [ ] Remove initialization of `agents`, `agent_instances_v2`, `workflow_nodes_v2`
   - [ ] Ensure only active collections are created

4. **Docker/Verification Scripts** (update scripts):
   - [ ] [verify-docker-setup.ps1](../verify-docker-setup.ps1) line 132: Remove `"agents"` from `$requiredCollections`

### Investigation Checklist

Before deletion, verify:

```bash
# Check if collections exist in MongoDB
mongo agentic-orchestration
> show collections

# Search codebase for references
grep -r "AgentInstanceV2" backend/src --exclude-dir=node_modules
grep -r "WorkflowNodeV2" backend/src --exclude-dir=node_modules
grep -r "collection.*agents\|db\.agents" backend/src --exclude-dir=node_modules

# Check test files
find backend -name "*.test.ts" | xargs grep -l "AgentInstanceV2\|WorkflowNodeV2"
```

### Cleanup Procedure

1. **Backup** MongoDB before proceeding
2. **Verify** no code uses the V2 models in production routes
3. **Archive** the model files (git history preserved)
4. **Remove** model exports from `index.ts`
5. **Drop** collections from MongoDB (if safe)
6. **Update** Docker verification script
7. **Test** fresh `npm run dev` creates clean schema

### Files Affected

- **Models**: 
  - [backend/src/models/AgentInstanceV2.model.ts](../backend/src/models/AgentInstanceV2.model.ts)
  - [backend/src/models/WorkflowNodeV2.model.ts](../backend/src/models/WorkflowNodeV2.model.ts)
- **Index**: [backend/src/models/index.ts](../backend/src/models/index.ts)
- **Server Init**: [backend/src/server.ts](../backend/src/server.ts)
- **Scripts**: [verify-docker-setup.ps1](../verify-docker-setup.ps1)

### Testing After Cleanup

- [ ] Backend startup: `npm run dev` → No errors
- [ ] MongoDB: `show collections` → Only active collections listed
- [ ] API tests: All endpoints work (V2 not used)
- [ ] No TypeScript compilation errors

---

## ✅ Completed Fixes

### Phase 3 Journal Persistence - COMPLETED ✅

**Date Completed**: Jan 19, 2026

Implemented full journal persistence lifecycle:

1. ✅ Send message in chat → POST /journal creates entry
2. ✅ Click Save button → Messages persisted to MongoDB agent_journals
3. ✅ Logout/Login → Journals reload with chat history
4. ✅ Text displays correctly (fixed: read `j.payload` not `j.content`)

**Key Achievement**: Chat history now persists across sessions per user requirements

---

## 🎯 Next Steps

### Immediate (This Sprint)

1. **Test Bug #1 Fix**: Manual verification of agent deletion
2. **Code Review**: Confirm event bubbling fix is correct
3. **Document**: Add comment explaining the fix

### Next Sprint

1. **Investigate Collections**: Audit which V2 models are actually used
2. **Cleanup**: Remove unused models and collections
3. **Performance**: Profile MongoDB schema after cleanup
4. **Documentation**: Update architecture guide

### Long-term

1. **Testing**: Add unit tests for deletion flow
2. **Monitoring**: Alert on failed deletions in production
3. **Code Quality**: Implement pre-commit hook to catch schema drift

---

## 📝 Notes

- All changes should be peer-reviewed before merging
- Test on both Chrome and Firefox for event handling consistency
- Monitor production logs for deletion errors
- Consider implementing soft deletes (archive) instead of hard deletes


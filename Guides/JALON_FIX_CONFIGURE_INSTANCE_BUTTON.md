# Fonctionnalité: Configure Agent Instance Button

**Status**: ✅ **STABLE** - Production-ready  
**Last Updated**: 2026-02-10  
**Severity**: P0 - Critical for user interaction

---

## 📌 Overview

The "Configure" button allows users to edit the configuration of an agent instance (model, system prompt, tools, etc.). This document provides technical guidance for maintaining and extending this functionality.

### Functional Requirements
- Users can open configuration modal for any agent instance on the canvas
- Modal displays all configurable properties of the instance
- Changes persist to backend when saved
- No "Instance non trouvée" errors should occur
- Works for both saved (DB) and unsaved (local) instances during a session

### Non-Functional Requirements
- Configure button must work within 100ms of click
- Modal must load configuration without lag
- Works across all supported locales
- No memory leaks from repeated Configure/Close cycles

---

## 🏗️ Architecture & Design

### Component Hierarchy

```
App.tsx (state management)
  ├─ WorkflowCanvas (visual layer)
  │   └─ V2AgentNode (individual agent nodes)
  │       └─ handleEdit() [Configure button handler]
  │
  └─ useDesignStore (Zustand store)
      └─ agentInstances: AgentInstance[]
      └─ hydrateFromServer(): hydrate from API
```

### Data Flow: Configure Button Click

```
User clicks "Configure" on Agent Node
            ↓
handleEdit() in V2AgentNode triggered
            ↓
Instance Lookup (4 fallback strategies)
      ✓ Found: setConfigModalInstanceId()
      ✗ Not found: Error popup + detailed diagnostics
            ↓
ConfigureInstanceModal opens
            ↓
User edits & clicks "Save"
            ↓
API POST /api/agent-instances/{id}
            ↓
Zustand store updated locally
            ↓
Modal closes, canvas reflects changes
```

---

## 🔑 Key Components

### 1. **V2AgentNode.tsx** (lines 190-284)
**Responsibility**: Instance lookup and error handling

**The `handleEdit()` function uses 4-tier fallback strategy**:
```typescript
// TIER 1: Check if instance passed directly in component props
if (agentInstance && agentInstance.id) { success }

// TIER 2: Search store by node ID pattern (node-{instanceId})
const found = agentInstances.find(i => i.id === nodeIdPattern)

// TIER 3: Search store by agent name (for unnamed instances)
const found = agentInstances.find(i => i.name === agentName)

// TIER 4: Search store by prototype ID (as last resort)
const found = agentInstances.find(i => i.prototypeId === prototypeId)

// FALLBACK: If nothing works, show detailed error with all available instance IDs
```

**Why 4 tiers?**
- Tier 1: Direct reference (fastest)
- Tier 2: Node ID (most reliable)
- Tier 3: Name matching (recovery from ID mismatch)
- Tier 4: Prototype matching (recovery from instance loss)

### 2. **App.tsx** - Hydration Effect (lines 245-595)
**Responsibility**: Load instance data from backend correctly

**Critical sequence** (MUST be maintained):
```
Authentication check (isAuthenticated)
         ↓
Hard reset: resetAll() [Clear Zustand state]
         ↓
Clear storage: localStorage.clear() + sessionStorage.clear()
         ↓
Set hydration guard: sessionStorage.setItem('_arc_hydrating', true)
         ↓
Fetch from API: GET /api/user/workspace
         ↓
Merge instances (dedup by ID): workspace + external API response
         ↓
Filter for validity: remove undefined/null instances
         ↓
ATOMIC hydration: Single hydrateFromServer() call
         ↓
Remove guard: sessionStorage.removeItem('_arc_hydrating')
         ↓
Result: Store contains ONLY backend data
```

**Why this sequence matters:**
- **resetAll() FIRST**: Ensures clean Zustand state
- **localStorage.clear() SECOND**: Prevents stale data reload
- **Hydration guard**: Prevents any middleware from reloading storage during the operation
- **ATOMIC call**: Single `hydrateFromServer()` prevents partial states
- **Filter validity**: Removes any invalid instance objects

### 3. **useDesignStore.ts** - Store Actions
**Responsibility**: State management for instances

Key methods:
```typescript
resetAll()              // Clear all state (agents, instances, nodes, edges)
hydrateFromServer()     // Population store with API data (ATOMIC - no merges)
setAgentInstances()     // Direct setter for testing
addAgentInstance()      // Add single instance to store
deleteAgentInstance()   // Remove instance from store
updateInstanceId()      // Rename instance IDs (for temp → backend ID mapping)
```

---

## 🐛 Common Issues & Solutions

### Issue #1: "Instance non trouvée" Error on Configure Click

**Root Causes** (in order of likelihood):
1. Instance exists on canvas (node visible) but not in `agentInstances` array
2. Instance ID mismatch between node and store
3. Store was cleared/reset after node render
4. Service worker cached stale component

**Diagnosis Steps**:
```javascript
// In browser console, when error occurs:
const { agentInstances } = useDesignStore.getState();
console.log('Instances in store:', agentInstances.map(i => i.id));
console.log('Nodes on canvas:', document.querySelectorAll('[data-testid*="agent-node"]').length);
```

**If instance count mismatch**:
- Check app console for hydration logs
- Look for "ÉTAPE 3 - Reset Validation" logs (should show EMPTY)
- Verify Backend API returns instance (check Network tab)

### Issue #2: Configure Opens but shows Empty Fields

**Root Causes**:
1. `configuration_json` field missing from instance
2. Instance type mismatch (AgentInstance vs WorkflowNode)
3. Component didn't receive instance prop properly

**Solution**:
- Ensure instance has valid `configuration_json` object
- Instance must have: `id`, `name`, `prototypeId`, `configuration_json`, `workflowId`
- Check type definition in `types.ts`

### Issue #3: Configure Changes Don't Persist

**Root Causes**:
1. Backend API endpoint unreachable
2. User not authenticated
3. Instance belongs to different user's workspace

**Check**:
- Verify JWT token valid: `localStorage.getItem('auth_token')`
- Check Network tab for POST `/api/agent-instances/{id}` response
- Verify 200/201 status code received

---

## ✅ Testing Checklist

For any changes to Configure functionality, verify:

- [ ] **Happy Path**: Create instance → Click Configure → Edit field → Save → Changes visible on canvas
- [ ] **Unsaved Instance**: Create instance (don't save) → Configure works during session → Instance gone after reload
- [ ] **Saved Instance**: Create instance → Save to DB → Logout → Login → Configure still works
- [ ] **Multiple Instances**: Create 3+ instances of same agent → Configure works on all
- [ ] **Different Agent Types**: Works for all 5 robot types (Archi, Bos, Com, Phil, Tim)
- [ ] **Modal Lifecycle**: Open/Close/Edit/Close cycles don't cause memory leaks
- [ ] **Error Recovery**: If Configure fails, error message is helpful + includes instance ID

### Manual Test Scenario
```
Session 1:
1. Login (authenticated user)
2. Create Agent Instance
3. Click Configure → Verify modal opens with correct data
4. Change system prompt → Click Save
5. Verify change appears on canvas
6. Create 2ND instance of SAME agent
7. Save ONLY first instance via "Save Workflow" button
8. Close browser completely

Session 2:
1. Reopen browser
2. Login with same user
3. Verify ONLY 1 instance visible (saved one)
4. Click Configure on visible instance → Must work (no error)
5. ✅ Test passed if no "Instance non trouvée" error
```

---

## 📚 Related Files

- Type definitions: [types.ts](../types.ts) - `AgentInstance`, `Agent` interfaces
- Configure modal: [ConfigureInstanceModal.tsx](../components/modals/ConfigureInstanceModal.tsx)
- Instance store: [useDesignStore.ts](../stores/useDesignStore.ts)
- API integration: [App.tsx](../App.tsx) - lines 245-595 (hydration)
- Node component: [V2AgentNode.tsx](../components/V2AgentNode.tsx) - lines 190-284 (handleEdit)

---

## 🚀 Future Enhancements

### Potential Improvements
1. **Validation**: Real-time validation of configuration changes before save
2. **Undo/Redo**: Track configuration changes within modal
3. **Comparison**: Show diff between current and previous configuration
4. **Quick Edit**: Right-click context menu for faster edits
5. **Bulk Configure**: Configure multiple instances at once

### Guidelines for Extensions
- Maintain the 4-tier fallback strategy in instance lookup
- Keep hydration sequence atomic (never split hydrateFromServer calls)
- Always clear storage before loading new user's data
- Add test cases for new scenarios
- Document changes to this guide



---

## 🔍 Root Cause Analysis - COMPLETED

### ROOT CAUSE #1: Instance Merge Contamination
**Found**: App.tsx ligne 345 ET 433 - deux appels `hydrateFromServer()` séquentiels

```typescript
// LIGNE 345: Hydrate agents (prototypes)
hydrateFromServer({ agents: hydratedPrototypes });

// LIGNE 433: Hydrate instances (après)
hydrateFromServer({ agentInstances: hydratedInstancesForStore });
```

**Problem**: DEUX calls à hydrateFromServer() = potentiel de race condition
- Appel 1 réinitialise agentInstances à []  
- Appel 2 charge les instances BDD
- **BUT**: S'il y a une autre source qui ajoute des instances pendant ce temps, elles 'mergen'

### ROOT CAUSE #2: Hydration Order Issue
**Found**: App.tsx lignes 247-260

```typescript
Line 247: useDesignStore.getState().resetAll();     ✅ Clear state
Line 255: localStorage.clear();                      ✅ Clear storage
Line 260: await fetch('api/user/workspace')         ✅ Fetch from API
```

**Problem**: localStorage.clear() est synchrone mais:
- Les données DONT qu'il réinitialise pourraient être recréées si un autre composant les recharge
- localStorage.clear() doit être accompanied d'une VÉRIFICATION qu'aucun autre code ne recharge

### ROOT CAUSE #3: Instance Lookup Failures
**Found**: V2AgentNode.tsx lignes 190-228

```typescript
// 4 strategies de lookup:
1. Direct agentInstance prop
2. Find by node ID
3. Find by agent name  
4. Find by prototypeId
```

**Problem**: Si AUCUNE des 4 ne marche, l'utilisateur voit "Instance non trouvée"
- Possible cause: Instance hydratée mais pas présente dans agentInstances array
- Cause probability: hydrateFromServer() n'a pas correctement sauvegardé l'instance

### ROOT CAUSE #4: Zustand State Merge Issue
**Found**: useDesignStore.ts ligne 577-595 - hydrateFromServer()

```typescript
hydrateFromServer: (data: {
  agents?: Agent[];
  agentInstances?: AgentInstance[];
  ...
}) => set({
  agents: data.agents || [],
  agentInstances: data.agentInstances || [],  // ✅ Replaces, not merges
  ...
})
```

**Analysis**: Code looks correct (replaces, not merges)
**BUT**: If hydrateFromServer() is called twice, order matters

---

---

## 🔧 SOLUTION: Unified Hydration Fix (SOLID Design)

### ÉTAPE FIX 1: Consolidate Hydration into Single Call
**Location**: App.tsx lines 345 + 433
**Problem**: Two separate hydrateFromServer() calls = race condition risk
**Solution**: Merge into ONE call after both agents AND instances are ready

**Changes**:
1. Keep hydrateFromServer({agents}) at line 345 ✅ (for agents only)
2. **REMOVE** duplicate data from line 433
3. **MERGE** agents + instances + nodes + edges into ONE final hydration call  
4. Call hydrateFromServer() **ONCE** with ALL data

**Pattern (SOLID - Single Responsibility)**:
- hydrateFromServer() called exactly ONCE
- Contains: agents + agentInstances + nodes + edges
- Atomicity: All or nothing, no partial states

### ÉTAPE FIX 2: Add localStorage Protection Guard  
**Location**: App.tsx after line 255
**Problem**: Something might reload localStorage after we clear it
**Solution**: Add a "no-persist" flag to prevent middleware reload

**Changes**:
1. After localStorage.clear(), add a sessionVar flag
2. Modify any Zustand middleware to check this flag
3. If flag = 'no-persist', don't load from localStorage

**Pattern (SOLID - Dependency Inversion)**:
- Don't let middleware reload stale data
- Make middleware aware of hydration state

### ÉTAPE FIX 3: Add Instance Hydration Validation  
**Location**: V2AgentNode.tsx handleEdit() - line 190
**Problem**: Instance lookup fails silently with generic error
**Solution**: Add pre-flight check before trying all 4 fallbacks

**Changes**:
1. Log storeState.agentInstances BEFORE trying lookups  
2. Log exact IDs being searched for
3. If not found, suggest "Instance not hydrated properly"
4. Add recovery: Try to trigger re-hydration

**Pattern (SOLID - Fail-Fast with Diagnostics)**:
- Know WHY it failed
- Suggest corrective action

### ÉTAPE FIX 4: Verify resetAll() Completeness
**Location**: stores/useDesignStore.ts line 564
**Problem**: resetAll() might not be clearing everything
**Solution**: Verify it clears ALL fields, not just some

**Changes**:
1. Check resetAll() clears: agents, agentInstances, nodes, edges
2. Verify no leftover state in other parts of store
3. Add verification log after resetAll()

**Pattern (SOLID - Completeness)**:
- Reset must be TOTAL, not partial

---

## ✅ IMPLEMENTATION STEPS (Sequential Execution)

### STEP 1: Consolidate Hydration Calls (App.tsx)
**File**: App.tsx  
**Action**: Merge two hydrateFromServer() calls into one atomic call
**Why**: Prevents race conditions and partial state

```
Current (WRONG):
Line 345: hydrateFromServer({ agents: data })      // Partial
Line 433: hydrateFromServer({ agentInstances: data }) // Partial

Fixed (CORRECT):
Line 433: hydrateFromServer({  
  agents: hydratedPrototypes,
  agentInstances: hydratedInstancesForStore,
  // nodes and edges if available
})  // ATOMIC - all or nothing
```

**Implementation Steps**:
- [ ] Comment out line 345 hydrateFromServer call
- [ ] Move agents data to the line 433 call
- [ ] Verify build succeeded
- [ ] Verify console shows SINGLE hydration log

### STEP 2: Add localStorage PersistenceGuard (App.tsx)
**File**: App.tsx after line 255
**Action**: Add flag to prev localStorage reload after clear()
**Why**: Prevents Zustand middleware from reloading stale data

```typescript
// After localStorage.clear() but before fetch:
sessionStorage.setItem('_hydrating', 'true');  // Signal to middleware
const hydrationPromise = fetch(...)            // Start fetch
// After hydration complete:
sessionStorage.removeItem('_hydrating');       // Clear signal
```

**Implementation Steps**:
- [ ] Add sessionStorage.setItem('_hydrating', 'true') at line 256
- [ ] Add sessionStorage.removeItem('_hydrating') after hydration done (line 575)
- [ ] Verify localStorage.clear() is NEVER called again after hydration starts

### STEP 3: Validate resetAll() Completeness (useDesignStore.ts)
**File**: stores/useDesignStore.ts line 564
**Action**: Ensure resetAll() returns COMPLETE clean state
**Why**: Prevention of instance contamination from previous sessions

```typescript
Current resetAll():
resetAll: () => set({
  currentRobotId: RobotId.Archi,
  agents: [],
  selectedAgentId: null,
  agentInstances: [],  // ✅ This must be []
  nodes: [],
  edges: []
}),
```

**Implementation Steps**:
- [ ] Verify all 6 keys are reset
- [ ] Add verification log BEFORE and AFTER resetAll()
- [ ] Confirm agents array is truly empty

### STEP 4: Add Diagnostic Logging to Hydration (App.tsx)
**File**: App.tsx line 575 (after hydration complete)
**Action**: Log exact content of hydrated instances for verification
**Why**: Debug visibility into what was actually loaded

```typescript
console.log('[App] ✅ HYDRATION COMPLETE:', {
  agentCount: hydratedPrototypes.length,
  instanceCount: mergedInstances.length,
  instanceIds: mergedInstances.map(i => ({ id: i.id, name: i.name }))
});
```

**Implementation Steps**:
- [ ] Add log statement showing instance IDs
- [ ] Add comparison: "Expected X from BDD, got Y from hydration"
- [ ] Flag if Y > X (indicates stale data from localStorage)

### STEP 5: Enhance Instance Lookup (V2AgentNode.tsx)
**File**: components/V2AgentNode.tsx line 190-228
**Action**: Add pre-flight validation before lookup attempts
**Why**: Fail-fast with diagnostics instead of generic error

```typescript
const handleEdit = () => {
  const storeState = useDesignStore.getState();
  
  // PRE-FLIGHT CHECK
  console.log('[V2AgentNode] 🔍 Pre-flight:', {
    nodeId: id,
    agentId: agent?.id,
    agentInstanceProp: agentInstance?.id,
    totalInstancesInStore: storeState.agentInstances.length,
    allInstanceIds: storeState.agentInstances.map(i => i.id)
  });
  
  // Then attempt the 4 fallback lookups...
}
```

**Implementation Steps**:
- [ ] Add pre-flight logging
- [ ] Execute and verify logs show all available instances
- [ ] If instance is in logs but lookup fails, there's a data structure problem

## ✅ VALIDATION (QA Test Plan)

### QA Test Case 1: Unsaved Instance Cleanup
```
Session 1:
1. Login (authenticated)
2. Create Agent Instance A-1
3. Create Agent Instance A-2 (same agent)
4. Save A-1 only
5. Browser console: Check localStorage content (should show both)
6. Check App.log: "instanceCount: 2"
7. Close browser

Session 2:
1. Open browser
2. Login
3. Browser console: Check sessionStorage shows "_hydrating: true" flag
4. After hydration: Flag removed
5. Check App.log: "instanceCount: 1" (ONLY saves instance)
6. Verify canvas shows ONLY A-1
7. Click Configure on A-1 → Should work
8. PASS ✅ if only A-1 visible and Configure works
```

### QA Test Case 2: Configure Button Always Works  
```
Precondition: A-1 (saved) visible after hydration
1. Click Configure on A-1
2. Verify modal opens (NO "Instance non trouvée" error)
3. Change setting (e.g., model)
4. Save configuration
5. PASS ✅ if works without errors
```

### QA Test Case 3: No Regression - Guest Mode
```
Session 1 GUEST (no login):
1. Create Instance G-1
2. Close browser (NO manual save to BDD)
3. Reopen in guest mode
4. Verify G-1 still visible (localStorage preserved)
5. PASS ✅ if G-1 still there
```

---

## 📊 Implementation Plan Summary

| Phase | Étape | Action | Owner | Status |
|-------|-------|--------|-------|--------|
| 1 | 1.1 | Analyze localStorage sync | TODO | ⏳ |
| 1 | 1.2 | Check hydrateFromServer() | TODO | ⏳ |
| 1 | 1.3 | Analyze V2AgentNode lookup | TODO | ⏳ |
| 2 | 2.1 | Fix persistence issue | TODO | ⏳ |
| 2 | 2.2 | Fix merge logic | TODO | ⏳ |
| 2 | 2.3 | Fix instance lookup | TODO | ⏳ |
| 3 | 3.1 | Manual QA test | TODO | ⏳ |
| 3 | 3.2 | Regression suite | TODO | ⏳ |

---

## References
- App.tsx hydration effect
- stores/useDesignStore.ts
- components/V2AgentNode.tsx
- Components/modals/ConfigureInstanceModal.tsx

# 🔍 QA TEST GUIDE: Debugging Empty Workflow UI

## Problem to Solve
QA tester reports `/bos/workflows/manage` page is completely **EMPTY** when loaded.

## Root Cause Investigation Steps

### STEP 1: Verify Authentication
```
1. Open DevTools (F12 → Console tab)
2. Type: localStorage.getItem('authToken')
3. Should return a long string starting with "eyJ"
   ✅ If YES → Authentication OK
   ❌ If null → User not logged in! Login first!
```

### STEP 2: Navigate to Page
```
1. Go to: http://127.0.0.1:4000/bos/workflows/manage
2. Wait 2 seconds for page to load
3. Right-click → Inspect (or F12)
```

### STEP 3: Check Component Mounted
In DevTools Console, paste:
```javascript
// Check if BosWorkflowManagementPage is rendering
const page = document.querySelector('[class*="bg-gray-900"]');
if (page) {
    console.log('✅ Page container found');
} else {
    console.log('❌ Page not rendering');
}

// Check for header (should say "Manage Workflows")
const header = document.body.innerHTML.includes('Manage Workflows');
if (header) {
    console.log('✅ Component header found');
} else {
    console.log('❌ Component not mounted');
}
```

### STEP 4: Check Console Logs
In DevTools Console tab, look for:
- `[BosWorkflows] Starting workflow load...` → Component lifecycle started
- `[BosWorkflows] Calling loadUserWorkflows()` → Load triggered
- `[Workflows] Attempting GET /api/workflows` → API call made
- `[Workflows] Found X workflows` → API returned data
- `[Workflows] Primary endpoint returned X workflows` → Success!

**If you see NO logs starting with `[Bos` or `[Workflows]`:**
→ Component not mounting or effect not running
→ Check AuthContext: is `isAuthenticated=true`?

### STEP 5: Check Network Tab (Advanced)
1. Open DevTools → Network tab
2. Refresh page (F5)
3. Look for requests:
   - `GET /api/workflows` → Should show `200 OK`
   - Response should be: `{"workflows": [{...}, {...}]}`
   - **If 401 Unauthorized** → Auth token expired
   - **If 404 Not Found** → Endpoint doesn't exist
   - **If 500 Internal Server Error** → Backend error

### STEP 6: Inspect Zustand Store (Advanced)
If React DevTools extension is installed:
1. Open DevTools → Components tab
2. Search for: "BosWorkflowManagementPage"
3. Expand component
4. Look at hooks:
   - `useDesignStore` should show:
     - `workflows: []` (empty) OR `workflows: [{...}]` (filled)
     - `isLoadingWorkflows: false` (should be loaded)

## Common Issues & Fixes

### ❌ Issue: "auth_data_v1 is null" in localStorage
**Fix**: Click Login again, credentials should be stored

### ❌ Issue: Console shows `[BosWorkflows] User not authenticated`
**Fix**: `isAuthenticated` is false even after login
- Check: `localStorage.getItem('authToken')`
- If missing: Login again
- If present: AuthContext might have hydration issue → F5 refresh

### ❌ Issue: Console shows `NO [Workflows] logs at all`
**Fix**: Component not mounting
- Component rendering condition failing (not authenticated?)
- Route not matching (check URL)
- Parent component (RobotPageRouter) not showing this page

### ❌ Issue: GET /api/workflows returns 500
**Fix**: Backend error
- Check backend console for error message
- Error might be related to validator trying to check workflow ownership
- Restart backend: `npm run dev`

### ❌ Issue: GET /api/workflows returns 200 but workflows=[empty]
**Fix**: No workflows in database for this user
- Expected for brand new account!
- Backend auto-creates default workflow
- Check backend logs: should see "AUTO-CREATION"

## Expected Behavior

✅ **Correct Flow:**
```
1. User logs in successfully
2. User navigates to /bos/workflows/manage
3. Console shows:
   - [BosWorkflows] Starting workflow load...
   - [Workflows] Attempting GET /api/workflows
   - GET /api/workflows → 200 OK
   - [Workflows] Primary endpoint returned 1 workflows
4. UI renders: "My Workflow" card appears
```

## Submit Diagnostic Report

When asking for help, copy-paste:
```
Browser: Chrome/Firefox/Edge
URL: http://127.0.0.1:4000/bos/workflows/manage
Auth: ✅/❌ (logged in or not)

Console logs (paste entire [BosWorkflows] and [Workflows] sections):
[paste here]

Expected vs Actual:
- Expected: See "My Workflow" card
- Actual: [describe what you see]

Network error status: [200/400/401/500]
```

## Still Broken? 

Post this complete diagnostic:
1. Browser DevTools Console output (all logs)
2. Network tab screenshot of `/api/workflows` response
3. Screenshot of page (what it looks like)
4. Backend console output when you refresh the page

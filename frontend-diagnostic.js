/**
 * FRONTEND DIAGNOSTIC INJECTION
 * To run in browser console: copy this script and paste in console
 * This will log detailed information about Zustand store and component state
 */

// Get the Zustand store (assuming useDesignStore is exposed or recoverable)
console.log('%c🔍 FRONTEND DIAGNOSTIC', 'background: #ff6b6b; color: white; padding: 10px; font-size: 14px');

// Check localStorage
const authToken = localStorage.getItem('authToken');
console.log('📝 Auth Token:', authToken ? '✅ Present' : '❌ Missing');

const authData = localStorage.getItem('auth_data_v1');
if (authData) {
  try {
    const parsed = JSON.parse(authData);
    console.log('📝 Auth Data:', {
      email: parsed.user?.email,
      userId: parsed.user?.id,
      hasToken: !!parsed.accessToken
    });
  } catch (e) {
    console.log('Auth data parse error:', e.message);
  }
}

// Check if React DevTools can find components
console.log('\n🔍 Checking React Components...');

// Try to find the BosWorkflowManagementPage component in DOM
const bos = document.querySelector('[class*="Bos"], [class*="Workflow"]');
console.log('BosWorkflowManagementPage mounted:', bos ? '✅ YES' : '❌ NO');

// Check for console errors
console.log('\n📊 Look at browser console above for any RED errors');
console.log('If you see loadUserWorkflows logs (blue), that means the function was called');

// Try to trigger the page render by checking current path
const currentPath = window.location.pathname;
console.log('Current path:', currentPath);
if (currentPath === '/bos/workflows/manage') {
  console.log('✅ Correct page URL');
} else {
  console.log('❌ Wrong page! Navigate to /bos/workflows/manage');
}

// Instructions
console.log(`
%cNEXT STEPS:
1. Open React DevTools (right-click → Inspect)
2. Go to "Console" tab
3. Look for logs starting with [BosWorkflows] or [Workflows]
4. If NO logs are shown → Component not mounting
5. If logs show → Check if workflows array has items
`, 'color: #4ecdc4; font-weight: bold');

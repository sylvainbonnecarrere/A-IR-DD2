/**
 * PHASE 2.3 - REAL BROWSER TEST
 * 
 * This test EXACTLY mimics what happens when user visits /bos/workflows/manage
 * Uses the EXISTING test@test.fr account (not a new one)
 */

const API_BASE = 'http://localhost:3001';
const TEST_ACCOUNT_EMAIL = process.env.QA_TEST_EMAIL || 'test@test.fr';
const TEST_ACCOUNT_PASSWORD = process.env.QA_TEST_PASSWORD || '';

// First, we need to get a real auth token by logging in with a dedicated QA account
async function realBrowserTest() {
    console.log('\n' + '='.repeat(70));
    console.log('PHASE 2.3 REAL BROWSER TEST: Exact User Flow Simulation');
    console.log('='.repeat(70));

    try {
        if (!TEST_ACCOUNT_PASSWORD) {
            console.error('❌ Missing QA_TEST_PASSWORD environment variable');
            console.error('   Example: $env:QA_TEST_PASSWORD="your-test-password"');
            return;
        }

        // ========================================
        // STEP 1: Login as configured QA account
        // ========================================
        console.log(`\n[REAL TEST] STEP 1: Login as ${TEST_ACCOUNT_EMAIL}`);
        
        const loginRes = await fetch(`${API_BASE}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                email: TEST_ACCOUNT_EMAIL,
                password: TEST_ACCOUNT_PASSWORD
            })
        });

        if (!loginRes.ok) {
            console.error('❌ Login failed:', loginRes.status);
            const err = await loginRes.text();
            console.error('   Error:', err);
            return;
        }

        var { accessToken, user } = await loginRes.json();

        console.log('✅ Logged in as:', user.email);
        console.log('   User ID:', user.id);
        console.log('   Auth token received');

        // ========================================
        // STEP 2: Call /api/user/workspace (what works)
        // ========================================
        console.log('\n[REAL TEST] STEP 2: Call GET /api/user/workspace');
        const workspaceRes = await fetch(`${API_BASE}/api/user/workspace`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (!workspaceRes.ok) {
            console.error('❌ Workspace endpoint failed:', workspaceRes.status);
            return;
        }

        const workspaceData = await workspaceRes.json();
        console.log('✅ /api/user/workspace response:', {
            hasWorkflow: !!workspaceData.workflow,
            workflowName: workspaceData.workflow?.name,
            workflowId: workspaceData.workflow?._id
        });

        // ========================================
        // STEP 3: Call /api/workflows (NEW endpoint)
        // ========================================
        console.log('\n[REAL TEST] STEP 3: Call GET /api/workflows (NEW endpoint)');
        const workflowsRes = await fetch(`${API_BASE}/api/workflows`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        console.log(`   Response status: ${workflowsRes.status}`);

        if (!workflowsRes.ok) {
            console.error(`❌ /api/workflows failed with ${workflowsRes.status}`);
            const errText = await workflowsRes.text();
            console.error('   Error response:', errText);
            return;
        }

        const workflowsData = await workflowsRes.json();
        console.log('✅ /api/workflows response:', workflowsData);

        if (!workflowsData.workflows || workflowsData.workflows.length === 0) {
            console.error('❌ ERROR: No workflows returned!');
            console.error('   This is why BosWorkflowManagementPage shows nothing');
            return;
        }

        console.log(`✅ Got ${workflowsData.workflows.length} workflow(s)`);
        workflowsData.workflows.forEach((w, i) => {
            console.log(`   [${i}] ${w.name} (${w._id})`);
            console.log(`       - isDefault: ${w.isDefault}`);
            console.log(`       - isActive: ${w.isActive}`);
            console.log(`       - agentCount: ${w.agentCount}`);
        });

        // ========================================
        // STEP 4: Verify endpoints consistency
        // ========================================
        console.log('\n[REAL TEST] STEP 4: Consistency check');
        
        const workspaceWorkflowId = workspaceData.workflow?._id;
        const newEndpointCount = workflowsData.workflows?.length || 0;

        if (newEndpointCount === 0) {
            console.error('❌ MISMATCH: /api/workflows returns 0 but /api/user/workspace has workflow!');
            console.error('   This is the SOURCE OF THE BUG');
            console.error('   Reason: ObjectId query still broken? Or /api/workflows not called?');
        } else if (workflowsData.workflows[0]._id === workspaceWorkflowId) {
            console.log('✅ CONSISTENT: Both endpoints return same workflow');
        } else {
            console.error('❌ MISMATCH: Endpoints return different workflows');
        }

        console.log('\n' + '='.repeat(70));
        console.log('TEST COMPLETE');
        console.log('='.repeat(70) + '\n');

    } catch (error) {
        console.error('❌ Test error:', error.message);
        console.error('Stack:', error.stack);
    }
}

realBrowserTest();

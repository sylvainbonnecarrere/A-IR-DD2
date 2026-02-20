/**
 * PHASE 2.3 - DIAGNOSTIC TEST
 * Tests the EXACT problem: Why does BosWorkflowManagementPage fail?
 */

const API_BASE = 'http://localhost:3001';

async function diagnosticTest() {
    console.log('\n' + '='.repeat(70));
    console.log('PHASE 2.3 DIAGNOSTIC: Find Root Cause');
    console.log('='.repeat(70));

    try {
        // ========================================
        // Create a fresh test account
        // ========================================
        const testEmail = `diag-${Date.now()}@test.fr`;
        const testPassword = 'DiagTest123!';
        
        console.log(`\n[DIAG] Creating fresh user: ${testEmail}`);
        const registerRes = await fetch(`${API_BASE}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                email: testEmail, 
                password: testPassword,
                confirmPassword: testPassword
            })
        });

        if (!registerRes.ok) {
            console.error('❌ Register failed:', registerRes.status);
            return;
        }

        console.log('✅ Account created');

        // ========================================
        // Login
        // ========================================
        console.log(`\n[DIAG] Login as ${testEmail}`);
        const loginRes = await fetch(`${API_BASE}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                email: testEmail, 
                password: testPassword
            })
        });

        if (!loginRes.ok) {
            console.error('❌ Login failed:', loginRes.status);
            return;
        }

        const { accessToken, user } = await loginRes.json();
        console.log('✅ Logged in');
        console.log(`   User ID: ${user.id}`);
        console.log(`   defaultWorkflowId: ${user.defaultWorkflowId || 'NULL'}`);
        console.log(`   workflowCount: ${user.workflowCount || 0}`);

        // ========================================
        // Test /api/user/workspace
        // ========================================
        console.log('\n[DIAG] Call GET /api/user/workspace');
        const workspaceRes = await fetch(`${API_BASE}/api/user/workspace`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (!workspaceRes.ok) {
            console.error(`❌ /api/user/workspace failed: ${workspaceRes.status}`);
            return;
        }

        const workspaceData = await workspaceRes.json();
        console.log('✅ Response:');
        console.log(`   hasWorkflow: ${!!workspaceData.workflow}`);
        if (workspaceData.workflow) {
            console.log(`   workflow._id: ${workspaceData.workflow._id}`);
            console.log(`   workflow.name: ${workspaceData.workflow.name}`);
        }

        // ========================================
        // Test /api/workflows - THE KEY TEST
        // ========================================
        console.log('\n[DIAG] Call GET /api/workflows (THE PROBLEM ENDPOINT)');
        const workflowsRes = await fetch(`${API_BASE}/api/workflows`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        console.log(`   Response status: ${workflowsRes.status}`);
        console.log(`   Response headers: ${JSON.stringify(Object.fromEntries(workflowsRes.headers), null, 2)}`);

        if (!workflowsRes.ok) {
            console.error(`❌ /api/workflows failed: ${workflowsRes.status}`);
            const errText = await workflowsRes.text();
            console.error('   Error:', errText);
            return;
        }

        const workflowsText = await workflowsRes.text();
        console.log('   Raw response body:');
        console.log(`   ${workflowsText.substring(0, 200)}...`);

        let workflowsData;
        try {
            workflowsData = JSON.parse(workflowsText);
        } catch (e) {
            console.error('❌ Response is not valid JSON:', e.message);
            return;
        }

        console.log('✅ Response parsed:');
        console.log('   Response structure:');
        console.log(`   - Has .workflows field: ${!!workflowsData.workflows}`);
        console.log(`   - Is array: ${Array.isArray(workflowsData)}`);
        console.log(`   - Length: ${(workflowsData.workflows || workflowsData).length || 'N/A'}`);

        const workflows = workflowsData.workflows || workflowsData;
        if (Array.isArray(workflows)) {
            console.log(`   - Workflows count: ${workflows.length}`);
            workflows.forEach((w, i) => {
                console.log(`     [${i}] ${w.name} - isDefault: ${w.isDefault}, isActive: ${w.isActive}`);
            });
        }

        // ========================================
        // Compare endpoints
        // ========================================
        console.log('\n[DIAG] Endpoint Comparison:');
        const workspaceHasWorkflow = !!workspaceData.workflow;
        const workflowsHasContent = workflowsData.workflows && workflowsData.workflows.length > 0;

        console.log(`   /api/user/workspace has workflow: ${workspaceHasWorkflow}`);
        console.log(`   /api/workflows has workflows: ${workflowsHasContent}`);

        if (workspaceHasWorkflow && !workflowsHasContent) {
            console.error('\n❌ MISMATCH FOUND: /api/user/workspace succeeds but /api/workflows is empty!');
            console.error('   This is exactly why BosWorkflowManagementPage fails!');
            console.error('');
            console.error('   PROBABLE CAUSES:');
            console.error('   1. /api/workflows has a bug finding workflows for new users');
            console.error('   2. /api/workflows response structure is wrong');
            console.error('   3. Frontend not correctly parsing /api/workflows response');
        } else if (workspaceHasWorkflow && workflowsHasContent) {
            console.log('\n✅ MATCH: Both endpoints return workflows correctly');
        }

        console.log('\n' + '='.repeat(70));

    } catch (error) {
        console.error('❌ Test error:', error.message);
    }
}

diagnosticTest();

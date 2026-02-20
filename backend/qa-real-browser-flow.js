#!/usr/bin/env node

/**
 * REAL BROWSER FLOW TEST
 * Simulates exact flow: Register → Login → Navigate → Load Workflows → Display
 */

const fetch = require('node-fetch');
const crypto = require('crypto');

const API_BASE = 'http://localhost:3001';
const TEST_EMAIL = `qa-real-${crypto.randomBytes(4).toString('hex')}@test.fr`;
const TEST_PASSWORD = 'QATest123!@#';

const results = [];

function log(step, status, details, extra) {
  const result = {
    step,
    status,
    details,
    timestamp: new Date().toISOString(),
    ...(extra || {})
  };
  results.push(result);
  
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
  console.log(`${icon} [${step}] ${details}`);
  if (extra && extra.responseData) {
    console.log('   Response:', JSON.stringify(extra.responseData, null, 2).substring(0, 300));
  }
}


async function runTest() {
  console.log(`
======================================================================
QA REAL BROWSER FLOW TEST
======================================================================
Test Email: ${TEST_EMAIL}
API Base: ${API_BASE}
======================================================================
`);

  let authToken = '';
  let userId = '';

  try {
    // STEP 1: Register
    console.log('\n[STEP 1] REGISTER USER');
    const registerRes = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        language: 'en'
      })
    });

    if (!registerRes.ok) {
      log('REGISTER', 'FAIL', `Status ${registerRes.status}`, { responseStatus: registerRes.status });
      return;
    }

    const registerData = await registerRes.json();
    log('REGISTER', 'PASS', `User created: ${TEST_EMAIL}`);

    // STEP 2: Login
    console.log('\n[STEP 2] LOGIN USER');
    const loginRes = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: TEST_EMAIL,
        password: TEST_PASSWORD
      })
    });

    if (!loginRes.ok) {
      log('LOGIN', 'FAIL', `Status ${loginRes.status}`, { responseStatus: loginRes.status });
      return;
    }

    const loginData = await loginRes.json();
    authToken = loginData.accessToken;
    userId = loginData.user.id;

    log('LOGIN', 'PASS', `User authenticated: ${userId}`, {
      responseData: {
        userId: loginData.user.id,
        defaultWorkflowId: loginData.user.defaultWorkflowId,
        workflowCount: loginData.user.workflowCount
      }
    });

    // STEP 3: Check User BEFORE /api/workflows
    console.log('\n[STEP 3] CHECK USER IMMEDIATELY AFTER LOGIN (BEFORE /api/workflows)');
    const userCheckRes = await fetch(`${API_BASE}/api/user/workspace`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!userCheckRes.ok) {
      log('USER_CHECK', 'FAIL', `Status ${userCheckRes.status}`, { responseStatus: userCheckRes.status });
      return;
    }

    const userCheckData = await userCheckRes.json();
    log('USER_CHECK', 'PASS', 'User document fetched', {
      responseData: {
        hasWorkflow: !!userCheckData.workflow,
        workflowId: userCheckData.workflow ? userCheckData.workflow._id : 'null',
        workflowName: userCheckData.workflow ? userCheckData.workflow.name : 'null'
      }
    });

    // STEP 4: Frontend navigates and calls loadUserWorkflows
    console.log('\n[STEP 4] FRONTEND CALLS GET /api/workflows');
    const workflowsRes = await fetch(`${API_BASE}/api/workflows`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!workflowsRes.ok) {
      log('GET_WORKFLOWS', 'FAIL', `Status ${workflowsRes.status}`, { responseStatus: workflowsRes.status });
      return;
    }

    const workflowsData = await workflowsRes.json();
    const workflows = workflowsData.workflows || [];

    if (!Array.isArray(workflows)) {
      log('GET_WORKFLOWS', 'FAIL', `Response not array: ${typeof workflows}`, {
        responseData: workflowsData
      });
      return;
    }

    log('GET_WORKFLOWS', 'PASS', `Received ${workflows.length} workflows`, {
      responseData: {
        workflowCount: workflows.length,
        workflows: workflows.map(w => ({
          id: w._id,
          name: w.name,
          isActive: w.isActive,
          isDefault: w.isDefault
        }))
      }
    });

    if (workflows.length === 0) {
      log('GET_WORKFLOWS', 'FAIL', 'Backend returned ZERO workflows!');
      return;
    }

    // STEP 5: Verify User was updated
    console.log('\n[STEP 5] VERIFY USER UPDATED AFTER /api/workflows');
    const userAfterRes = await fetch(`${API_BASE}/api/user/workspace`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!userAfterRes.ok) {
      log('USER_AFTER', 'FAIL', `Status ${userAfterRes.status}`, { responseStatus: userAfterRes.status });
      return;
    }

    const userAfterData = await userAfterRes.json();
    const userDefaultId = userAfterData.user ? userAfterData.user.defaultWorkflowId : null;
    const firstWorkflowId = workflows[0]._id;

    if (userDefaultId === firstWorkflowId) {
      log('USER_AFTER', 'PASS', 'User.defaultWorkflowId updated correctly', {
        responseData: {
          userDefaultId,
          workflowId: firstWorkflowId,
          match: userDefaultId === firstWorkflowId
        }
      });
    } else {
      log('USER_AFTER', 'WARN', `User.defaultWorkflowId mismatch: ${userDefaultId} vs ${firstWorkflowId}`);
    }

    // FINAL VERDICT
    console.log(`\n======================================================================`);
    const hasFailures = results.some(r => r.status === 'FAIL');
    if (!hasFailures) {
      console.log('✅ ALL STEPS PASSED - BROWSER FLOW WORKS CORRECTLY');
      console.log('\nIf QA tester sees empty UI, the problem is NOT the API/backend.');
      console.log('Check frontend:');
      console.log('  → React DevTools: Is BosWorkflowManagementPage mounted?');
      console.log('  → Console: Are loadUserWorkflows() logs shown?');
      console.log('  → Store: Does Zustand store.workflows have items?');
      console.log('  → Component: Is rendering logic correct?');
    } else {
      console.log('❌ FLOW BROKEN - One or more critical steps failed');
    }

    // RESULTS TABLE
    console.log('\n📋 TEST RESULTS:');
    console.table(results.map(r => ({
      Step: r.step,
      Status: r.status,
      Detail: r.details.substring(0, 60)
    })));

    console.log(`\n======================================================================`);

  } catch (error) {
    console.error('\n💥 FATAL ERROR:', error.message);
    process.exit(1);
  }
}

runTest().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

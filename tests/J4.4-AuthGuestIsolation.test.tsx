import React, { useEffect, useState } from 'react';
import { render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { authSessionStorage } from '../utils/authSessionStorage';
import { GUEST_STORAGE_KEYS } from '../utils/guestDataUtils';
import { useDesignStore } from '../stores/useDesignStore';
import { useWorkflowStore } from '../stores/useWorkflowStore';
import { useRuntimeStore } from '../stores/useRuntimeStore';

/**
 * Regression test J4.4 - Auth / Guest isolation
 * Scenario:
 * 1. Simulate existing guest data in localStorage and in-memory stores
 * 2. Simulate an authenticated session stored in localStorage
 * 3. Mount AuthProvider which hydrates session from storage
 * 4. Call logout()
 * Expected:
 * - authSessionStorage is cleared
 * - all guest localStorage keys listed in GUEST_STORAGE_KEYS are removed
 * - zustand stores (design, workflow, runtime) have been reset
 */

const TestComponent: React.FC<{ onDone: (result: unknown) => void }> = ({ onDone }) => {
  const auth = useAuth();
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (auth.isLoading) return; // wait hydration

    // Perform logout and then evaluate effects
    auth.logout();

    // Allow microtask queue to flush and stores to update
    setTimeout(() => {
      const authRead = authSessionStorage.read();

      const anyGuestKeyRemaining = Object.values(GUEST_STORAGE_KEYS).some((k) => localStorage.getItem(k) !== null);

      const design = useDesignStore.getState();
      const workflow = useWorkflowStore.getState();
      const runtime = useRuntimeStore.getState();

      const result = {
        authMissing: authRead.status === 'missing',
        anyGuestKeyRemaining,
        designAgents: (design.agents || []).length,
        designInstances: (design.agentInstances || []).length,
        nodes: (design.nodes || []).length,
        workflowWorkflows: workflow.currentWorkflow ? 1 : 0,
        runtimeSessions: (runtime as unknown as { sessions?: unknown[] }).sessions?.length,
      };

      onDone(result);
      setDone(true);
    }, 0);
  }, [auth.isLoading]);

  return <div>{done ? 'done' : 'running'}</div>;
};

test('J4.4 - logout clears guest storage and resets stores', async () => {
  // 1) Seed guest localStorage keys
  localStorage.setItem(GUEST_STORAGE_KEYS.agentInstances, JSON.stringify([{ id: 'gi-1' }]));
  localStorage.setItem(GUEST_STORAGE_KEYS.workflow, JSON.stringify({ _id: 'wf-guest' }));

  // 2) Seed some store data (simulate guest in-memory state)
  useDesignStore.setState({
    agents: [{ id: 'a1' }],
    agentInstances: [{ id: 'i1', prototypeId: 'a1' }],
    nodes: [{ id: 'node-i1', data: { agentInstance: { id: 'i1' } } }],
  } as unknown as Parameters<typeof useDesignStore.setState>[0]);
  useWorkflowStore.setState({ currentWorkflow: { id: 'wf-1', name: 'W1', isActive: true, isDefault: false } });
  // runtime store shape is less strict — set a sessions array if present
  try {
    useRuntimeStore.setState({ sessions: [{ id: 's1' }] } as unknown as Parameters<typeof useRuntimeStore.setState>[0]);
  } catch {}

  // 3) Simulate authenticated session in localStorage
  authSessionStorage.write({ user: { id: 'u-test', email: 'test@test.fr' }, accessToken: 'tok', refreshToken: 'ref' });

  // 4) Render provider + test component and assert results
  let finalResult: Record<string, unknown> | null = null;

  render(
    <AuthProvider>
      <TestComponent
        onDone={(r) => {
          finalResult = r as Record<string, unknown>;
        }}
      />
    </AuthProvider>,
  );

  await waitFor(() => expect(finalResult).not.toBeNull(), { timeout: 2000 });
  const res = finalResult as Record<string, unknown>;

  expect(res.authMissing).toBe(true);
  expect(res.anyGuestKeyRemaining).toBe(false);
  expect(res.designAgents).toBe(0);
  expect(res.designInstances).toBe(0);
  expect(res.nodes).toBe(0);
  expect(res.workflowWorkflows).toBe(0);
});

/**
 * Fix useDesignStore.ts - V3 (searches only after create() call)
 */
const fs = require('fs');
const path = require('path');

const filePath = path.resolve(__dirname, '..', 'stores', 'useDesignStore.ts');
const rawContent = fs.readFileSync(filePath, 'utf8');
const hasCRLF = rawContent.includes('\r\n');
const lines = rawContent.split(/\r?\n/);
console.log(`Lines: ${lines.length}, CRLF: ${hasCRLF}`);

// Find create() boundary - only search for implementations after this
const createLineIdx = lines.findIndex(l => l.includes('create<DesignStore>'));
console.log(`create() at line ${createLineIdx + 1}`);

// STEP 1: Add apiClient import
const importIdx = lines.findIndex(l => l.includes("GovernanceService"));
if (importIdx >= 0 && !lines.some(l => l.includes("import apiClient"))) {
  lines.splice(importIdx + 1, 0, "import apiClient from '../utils/apiClient';");
  console.log(`✅ Added apiClient import`);
}

// Re-find create boundary after possible import insertion
const createIdx = lines.findIndex(l => l.includes('create<DesignStore>'));

// Helper: find function block ONLY after create() call
function findFn(fnName) {
  let fnLine = -1;
  for (let i = createIdx; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    // Match implementation: "fnName: async" or "fnName: ("
    if (trimmed.startsWith(fnName + ':') && (trimmed.includes('async') || trimmed.includes('('))) {
      fnLine = i;
      break;
    }
  }
  if (fnLine === -1) return null;

  // Walk back to JSDoc
  let start = fnLine;
  for (let i = fnLine - 1; i >= createIdx; i--) {
    const t = lines[i].trim();
    if (t.startsWith('/**')) { start = i; break; }
    if (t.startsWith('*') || t.startsWith('*/') || t === '') continue;
    break;
  }

  // Walk forward counting braces
  let depth = 0, opened = false, end = fnLine;
  for (let i = fnLine; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; opened = true; }
      if (ch === '}') depth--;
    }
    if (opened && depth === 0) { end = i; break; }
  }

  return { start, end };
}

// STEP 2: All replacements
const fns = {
  loadUserWorkflows: [
    '  /**',
    '   * Load all workflows for the current user',
    '   * ⭐ V2: Utilise apiClient (auth + baseURL automatiques)',
    '   */',
    '  loadUserWorkflows: async () => {',
    '    set({ isLoadingWorkflows: true, workflowLoadError: null });',
    '    try {',
    "      console.log('[Workflows] Attempting GET /api/workflows via apiClient');",
    '',
    "      const { data } = await apiClient.get('/api/workflows');",
    '      const workflows: Workflow[] = data.workflows || data;',
    '',
    '      console.log(`[Workflows] Primary endpoint returned ${workflows.length} workflows`);',
    '',
    '      // Auto-select active workflow',
    '      const activeWorkflow = workflows.find((w: Workflow) => w.isActive);',
    '',
    '      set({',
    '        workflows,',
    "        currentWorkflowId: activeWorkflow?._id || (workflows.length > 0 ? workflows[0]._id : null),",
    '        isLoadingWorkflows: false,',
    '        workflowLoadError: null',
    '      });',
    '',
    "      console.log('[Workflows] State updated successfully');",
    '    } catch (primaryError) {',
    '      // ⭐ ROBUST FALLBACK: Try workspace endpoint if primary fails',
    "      console.warn('[Workflows] Primary endpoint failed, attempting fallback to /api/user/workspace');",
    '      try {',
    "        const { data: workspaceData } = await apiClient.get('/api/user/workspace');",
    '        const currentWorkflow = workspaceData.workflow;',
    '        if (!currentWorkflow) {',
    "          throw new Error('No workflow in workspace response');",
    '        }',
    '',
    '        const workflows: Workflow[] = [{',
    '          _id: currentWorkflow._id || currentWorkflow.id,',
    "          userId: workspaceData.metadata?.userId || '',",
    '          name: currentWorkflow.name,',
    "          description: currentWorkflow.description || '',",
    '          isActive: currentWorkflow.isActive,',
    '          isDefault: currentWorkflow.isDefault || false,',
    '          createdAt: currentWorkflow.createdAt,',
    '          updatedAt: currentWorkflow.updatedAt',
    '        }];',
    '',
    '        set({',
    '          workflows,',
    '          currentWorkflowId: workflows[0]._id,',
    '          isLoadingWorkflows: false,',
    '          workflowLoadError: null',
    '        });',
    "        console.log('[Workflows] Successfully loaded 1 workflow via fallback endpoint');",
    '      } catch (fallbackError) {',
    "        const errorMsg = fallbackError instanceof Error ? fallbackError.message : 'Unknown error loading workflows';",
    "        console.error('[Workflows] Fatal error:', errorMsg);",
    '        set({ workflowLoadError: errorMsg, isLoadingWorkflows: false });',
    '        throw fallbackError;',
    '      }',
    '    }',
    '  },',
  ],
  selectWorkflow: [
    '  /**',
    '   * Select a workflow by ID - atomically updates agents/nodes/edges',
    '   * ⭐ V2: Utilise apiClient',
    '   */',
    '  selectWorkflow: async (workflowId: string) => {',
    '    set({ isLoadingWorkflows: true, workflowLoadError: null });',
    '    try {',
    '      const { data } = await apiClient.post(`/api/workflows/${workflowId}/select`);',
    '',
    '      set({',
    '        currentWorkflowId: workflowId,',
    "        agentInstances: data.reloadedData?.agents || [],",
    "        nodes: data.reloadedData?.nodes || [],",
    "        edges: data.reloadedData?.edges || [],",
    '        isLoadingWorkflows: false',
    '      });',
    '',
    '      return data;',
    '    } catch (error) {',
    "      const msg = error instanceof Error ? error.message : 'Unknown error';",
    '      set({ workflowLoadError: msg, isLoadingWorkflows: false });',
    '      throw error;',
    '    }',
    '  },',
  ],
  createWorkflow: [
    '  /**',
    '   * Create new workflow',
    '   * ⭐ V2: Utilise apiClient',
    '   */',
    '  createWorkflow: async (name: string, description?: string): Promise<Workflow> => {',
    '    set({ isLoadingWorkflows: true, workflowLoadError: null });',
    '    try {',
    "      const { data: newWorkflow } = await apiClient.post('/api/workflows', { name, description });",
    '',
    '      set((state) => ({',
    '        workflows: [...state.workflows, newWorkflow],',
    '        isLoadingWorkflows: false',
    '      }));',
    '',
    '      return newWorkflow;',
    '    } catch (error) {',
    "      const msg = error instanceof Error ? error.message : 'Unknown error';",
    '      set({ workflowLoadError: msg, isLoadingWorkflows: false });',
    '      throw error;',
    '    }',
    '  },',
  ],
  updateWorkflow: [
    '  /**',
    '   * Update workflow (name/description)',
    '   * ⭐ V2: Utilise apiClient + PUT pour correspondre au backend',
    '   */',
    '  updateWorkflow: async (id: string, name: string, description?: string) => {',
    '    set({ isLoadingWorkflows: true, workflowLoadError: null });',
    '    try {',
    '      const { data: updatedWorkflow } = await apiClient.put(`/api/workflows/${id}`, { name, description });',
    '',
    '      set((state) => ({',
    '        workflows: state.workflows.map(w => w._id === id ? updatedWorkflow : w),',
    '        isLoadingWorkflows: false',
    '      }));',
    '    } catch (error) {',
    "      const msg = error instanceof Error ? error.message : 'Unknown error';",
    '      set({ workflowLoadError: msg, isLoadingWorkflows: false });',
    '      throw error;',
    '    }',
    '  },',
  ],
  deleteWorkflow: [
    '  /**',
    '   * Delete workflow - with cascade handling',
    '   * ⭐ V2: Utilise apiClient',
    '   */',
    '  deleteWorkflow: async (id: string) => {',
    '    set({ isLoadingWorkflows: true, workflowLoadError: null });',
    '    try {',
    '      await apiClient.delete(`/api/workflows/${id}`);',
    '',
    '      set((state) => {',
    "        const remaining = state.workflows.filter(w => w._id !== id);",
    '',
    '        // If current workflow was deleted, auto-select another',
    '        let nextWorkflowId = state.currentWorkflowId;',
    '        if (state.currentWorkflowId === id && remaining.length > 0) {',
    '          nextWorkflowId = remaining[0]._id;',
    '        }',
    '',
    '        return {',
    '          workflows: remaining,',
    '          currentWorkflowId: nextWorkflowId,',
    '          isLoadingWorkflows: false',
    '        };',
    '      });',
    '    } catch (error) {',
    "      const msg = error instanceof Error ? error.message : 'Unknown error';",
    '      set({ workflowLoadError: msg, isLoadingWorkflows: false });',
    '      throw error;',
    '    }',
    '  },',
  ],
  getActiveWorkflow: [
    '  /**',
    '   * Get currently active workflow',
    '   */',
    '  getActiveWorkflow: () => {',
    '    const state = get();',
    '    if (!state.currentWorkflowId) return undefined;',
    '    return state.workflows.find(w => w._id === state.currentWorkflowId);',
    '  },',
  ],
  getWorkflowStats: [
    '  /**',
    '   * Get workflow statistics (agent/node counts)',
    '   * ⭐ V2: Utilise apiClient',
    '   */',
    '  getWorkflowStats: async (id: string) => {',
    '    try {',
    '      const { data } = await apiClient.get(`/api/workflows/${id}/stats`);',
    '      return data;',
    '    } catch (error) {',
    "      console.error('Failed to fetch workflow stats:', error);",
    '      return null;',
    '    }',
    '  },',
  ],
};

// STEP 3: Collect blocks (search only after create() line)
const blocks = [];
const fnOrder = ['loadUserWorkflows', 'selectWorkflow', 'createWorkflow', 'updateWorkflow', 'deleteWorkflow', 'getActiveWorkflow', 'getWorkflowStats'];

for (const name of fnOrder) {
  const block = findFn(name);
  if (block) {
    blocks.push({ name, ...block, code: fns[name] });
    console.log(`  ${name}: lines ${block.start + 1}-${block.end + 1} (${block.end - block.start + 1} lines)`);
  } else {
    console.error(`  ❌ ${name} NOT FOUND`);
  }
}

// STEP 4: Replace bottom-up
blocks.sort((a, b) => b.start - a.start);
for (const b of blocks) {
  const removed = b.end - b.start + 1;
  lines.splice(b.start, removed, ...b.code);
  console.log(`✅ ${b.name}: removed ${removed} → inserted ${b.code.length}`);
}

// STEP 5: Write
const sep = hasCRLF ? '\r\n' : '\n';
fs.writeFileSync(filePath, lines.join(sep), 'utf8');

// STEP 6: Verify
const v = fs.readFileSync(filePath, 'utf8');
const auth = (v.match(/localStorage\.getItem\('authToken'\)/g) || []).length;
const api = (v.match(/apiClient\./g) || []).length;
const imp = v.includes("import apiClient");
console.log(`\n✅ Done! Lines: ${lines.length}`);
console.log(`   authToken refs: ${auth} (expected 0)`);
console.log(`   apiClient refs: ${api} (expected 7+)`);
console.log(`   apiClient import: ${imp}`);
if (auth > 0) {
  v.split(/\r?\n/).forEach((l, i) => {
    if (l.includes("authToken")) console.error(`   ⚠️  L${i+1}: ${l.trim()}`);
  });
}

/**
 * Fix V5 Jalon 3: Inject switchToWorkflow + workflow:switch listener into App.tsx on disk
 * The VS Code buffer has this code but disk doesn't (buffer persistence issue).
 * 
 * INSERTION POINT: After line 784 (}, [isAuthenticated, accessToken]);)
 * and before the "PHASE 2: Reset runtime store" useEffect.
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'App.tsx');
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

console.log(`[J3 Script] App.tsx on disk: ${lines.length} lines`);

// Verify switchToWorkflow is NOT already on disk
if (content.includes('switchToWorkflow')) {
  console.log('✅ switchToWorkflow already exists on disk — nothing to do');
  process.exit(0);
}

// Find insertion point: after "}, [isAuthenticated, accessToken]);"
// and before "// ⭐ PHASE 2: Reset runtime store when workflow changes"
const insertionMarker = '// ⭐ PHASE 2: Reset runtime store when workflow changes';
const insertionIndex = lines.findIndex(l => l.includes(insertionMarker));

if (insertionIndex === -1) {
  console.error('❌ Could not find insertion marker:', insertionMarker);
  process.exit(1);
}

console.log(`[J3 Script] Insertion point found at line ${insertionIndex + 1}`);

const codeToInject = `
  /**
   * ⭐ V2 SWITCH WORKFLOW: Fonction unifiée de réhydratation complète
   * Orchestre le switch de workflow avec feedback UX (HydrationOverlay)
   * 
   * SÉQUENCE:
   * 1. Overlay ON → feedback visuel immédiat
   * 2. Reset runtime store → nettoyer chat/execution du workflow précédent
   * 3. Fetch les données du workflow via POST /select (si pas déjà en store)
   * 4. Hydrater useWorkflowStore (metadata: name, canvasState, etc.)
   * 5. Recharger les journals → restaurer l'historique chat
   * 6. Reconstruire le React state legacy → workflowNodes pour le canvas
   * 7. Overlay OFF → transition fluide
   */
  const switchToWorkflow = useCallback(async (workflowId: string) => {
    if (!accessToken) {
      console.warn('[SwitchWorkflow] ⚠️ No accessToken — aborting switch');
      window.dispatchEvent(new CustomEvent('workflow:switch:error', {
        detail: { error: 'Authentification requise pour changer de workflow' }
      }));
      return;
    }
    
    console.log('[SwitchWorkflow] ⭐ Starting full workflow switch to:', workflowId);
    
    // 1. Overlay ON
    setHydrationMessage('Chargement du workflow...');
    setIsHydrating(true);
    setHydrationProgress(10);
    
    try {
      // 2. Reset runtime store (chat, execution, minimized states)
      useRuntimeStore.getState().resetAll();
      setHydrationProgress(20);
      
      // 3. Les données sont déjà partiellement en store via selectWorkflow(),
      //    mais on a besoin des données brutes pour journals + workflowStore.
      //    On refetch via /select pour les obtenir.
      const { data } = await apiClient.post(\`/api/workflows/\${workflowId}/select\`);
      const reloadedData = data.reloadedData;
      const workflowMeta = data.workflow;
      
      // Update design store with fresh data
      useDesignStore.getState().hydrateFromServer({
        agentInstances: reloadedData?.agents || [],
        nodes: reloadedData?.nodes || [],
        edges: reloadedData?.edges || []
      });
      useDesignStore.getState().setCurrentWorkflowId(workflowId);
      setHydrationProgress(40);
      
      // 4. Hydrater useWorkflowStore (metadata: name, isDefault, canvasState)
      if (workflowMeta) {
        hydrateWorkflowFromServer({
          id: workflowMeta._id || workflowId,
          name: workflowMeta.name,
          description: workflowMeta.description,
          isDefault: workflowMeta.isDefault,
          isActive: workflowMeta.isActive,
          canvasState: reloadedData?.canvasState || workflowMeta.canvasState
        });
      }
      setHydrationProgress(60);
      
      // 5. Recharger les journals pour chaque instance du nouveau workflow
      const instances = reloadedData?.agents || [];
      for (const instance of instances) {
        const instanceId = instance._id || instance.id;
        try {
          const journalRes = await apiClient.get(
            \`/api/workflows/\${workflowId}/instances/\${instanceId}/journals\`
          );
          const journals = journalRes.data?.data || journalRes.data?.journals || [];
          
          if (journals.length > 0) {
            const chatMessages: ChatMessage[] = journals
              .filter((j: any) => j.type === 'chat')
              .map((j: any) => {
                const payload = j.payload || {};
                const role = payload.role || 'agent';
                const content = payload.content || '';
                
                return {
                  id: j._id || \`journal-\${j.timestamp}\`,
                  sender: role === 'user' ? 'user' :
                         role === 'agent' ? 'agent' :
                         role === 'tool' ? 'tool' :
                         role === 'tool_result' ? 'tool_result' : 'agent',
                  text: content,
                  timestamp: new Date(j.createdAt || j.timestamp)
                } as ChatMessage;
              });
            
            const nodeId = \`node-\${instanceId}\`;
            useRuntimeStore.getState().setNodeMessages(nodeId, chatMessages);
            console.log(\`[SwitchWorkflow] Loaded \${chatMessages.length} messages for \${nodeId}\`);
          }
        } catch {
          console.warn(\`[SwitchWorkflow] Journals load failed for instance \${instanceId}\`);
        }
      }
      setHydrationProgress(80);
      
      // 6. Reconstruire React state legacy (workflowNodes pour le canvas)
      if (instances.length > 0) {
        const now = new Date().toISOString();
        const hydrationNodes: WorkflowNode[] = instances.map((inst: any) => ({
          id: inst._id || inst.id,
          agent: {
            id: inst._id || inst.id,
            name: inst.name,
            // ⭐ J6: Fallbacks défensifs — configuration_json → champ plat → valeur par défaut
            role: inst.configuration_json?.role || inst.role || 'assistant',
            systemPrompt: inst.configuration_json?.systemPrompt || inst.systemPrompt || '',
            llmProvider: (inst.configuration_json?.llmProvider || inst.llmProvider || LLMProvider.Gemini) as LLMProvider,
            model: inst.configuration_json?.model || inst.llmModel || 'gemini-2.0-flash',
            capabilities: inst.configuration_json?.capabilities || inst.capabilities || [],
            tools: inst.configuration_json?.tools || inst.tools || [],
            historyConfig: inst.configuration_json?.historyConfig || inst.historyConfig || {},
            creator_id: RobotId.Archi,
            created_at: inst.createdAt || now,
            updated_at: now
          } as Agent,
          position: inst.configuration_json?.position || inst.position || { x: 0, y: 0 },
          messages: [],
          isMinimized: false,
          isMaximized: false,
          instanceId: inst._id || inst.id
        }));
        setWorkflowNodes(hydrationNodes);
        
        // Also rebuild V2 nodes for the design store
        const v2Nodes: V2WorkflowNode[] = instances.map((inst: any) => ({
          id: \`node-\${inst._id || inst.id}\`,
          type: 'agent' as const,
          position: inst.configuration_json?.position || inst.position || { x: 0, y: 0 },
          data: {
            robotId: RobotId.Archi,
            label: inst.name,
            agentInstance: inst,
            workflowId,
            isMinimized: false,
            isMaximized: false
          }
        }));
        setNodes(v2Nodes);
      } else {
        setWorkflowNodes([]);
        setNodes([]);
      }
      setHydrationProgress(100);
      
      // ⭐ V5: Refresh workflows list to sync isActive/isDefault flags
      try {
        await useDesignStore.getState().loadUserWorkflows();
      } catch (refreshErr) {
        console.warn('[SwitchWorkflow] Workflows list refresh failed (non-blocking):', refreshErr);
      }
      
      console.log('[SwitchWorkflow] ✅ Workflow switch complete:', {
        workflowId,
        instancesCount: instances.length
      });
      
      // ⭐ V5: Notify observers of successful switch
      window.dispatchEvent(new CustomEvent('workflow:switch:success', {
        detail: { workflowId }
      }));
      
    } catch (error) {
      console.error('[SwitchWorkflow] ❌ Error:', error);
      // ⭐ V5: Notify observers of switch failure with error detail
      const errorMsg = error instanceof Error ? error.message : 'Erreur lors du changement de workflow';
      window.dispatchEvent(new CustomEvent('workflow:switch:error', {
        detail: { error: errorMsg, workflowId }
      }));
    } finally {
      // 7. Overlay OFF (petit délai pour transition smooth)
      setTimeout(() => {
        setIsHydrating(false);
        setHydrationProgress(0);
        setHydrationMessage('Chargement de votre workspace...');
      }, 300);
    }
  }, [accessToken, hydrateWorkflowFromServer, setNodes]);

  /**
   * ⭐ V2: Listen for workflow:switch custom events from BosWorkflowManagementPage
   * Pattern Observer — découplage entre la page BOS et l'orchestration App.tsx
   */
  useEffect(() => {
    const handleWorkflowSwitch = (event: Event) => {
      const { workflowId } = (event as CustomEvent).detail;
      if (workflowId) {
        switchToWorkflow(workflowId);
      }
    };
    
    window.addEventListener('workflow:switch', handleWorkflowSwitch);
    return () => window.removeEventListener('workflow:switch', handleWorkflowSwitch);
  }, [switchToWorkflow]);
`;

// Insert before the PHASE 2 comment
const before = lines.slice(0, insertionIndex);
const after = lines.slice(insertionIndex);
const newLines = [...before, ...codeToInject.split('\n'), ...after];

fs.writeFileSync(filePath, newLines.join('\n'), 'utf8');
console.log(`✅ App.tsx written: ${newLines.length} lines (was ${lines.length})`);

// === VERIFY ===
const verify = fs.readFileSync(filePath, 'utf8');
const checks = [
  'switchToWorkflow',
  'workflow:switch:error',
  'workflow:switch:success',
  'loadUserWorkflows',
  'handleWorkflowSwitch',
  'Authentification requise'
];

let allGood = true;
for (const check of checks) {
  if (verify.includes(check)) {
    console.log(`  ✓ ${check} — FOUND`);
  } else {
    console.error(`  ✗ ${check} — NOT FOUND`);
    allGood = false;
  }
}

if (allGood) {
  console.log('\n🎉 Jalon 3 complete — switchToWorkflow + listener injected on disk');
} else {
  console.error('\n❌ Some patterns not found — manual review required');
  process.exit(1);
}

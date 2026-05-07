import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Agent, LLMConfig, LLMProvider, WorkflowNode, LLMCapability, ChatMessage, HistoryConfig, RobotId, V2WorkflowNode, AgentInstance } from './types';
import { NavigationLayout } from './components/NavigationLayout';
import { RobotPageRouter } from './components/RobotPageRouter';
import { AgentFormModal } from './components/modals/AgentFormModal';
import { SettingsModal } from './components/modals/SettingsModal';
import { Header } from './components/Header';
import { getAllGuestKeys } from './utils/guestDataUtils';
import { LoginModal } from './components/modals/LoginModal';
import { RegisterModal } from './components/modals/RegisterModal';
import { ImageGenerationPanel } from './components/panels/ImageGenerationPanel';
import { ImageModificationPanel } from './components/panels/ImageModificationPanel';
import { VideoGenerationConfigPanel } from './components/panels/VideoGenerationConfigPanel';
import { MapsGroundingConfigPanel } from './components/panels/MapsGroundingConfigPanel';
import { useLocalization } from './hooks/useLocalization';
import { Button } from './components/UI';
import { ConfirmationModal } from './components/modals/ConfirmationModal';
import { FullscreenChatModal } from './components/modals/FullscreenChatModal';
import { AgentConfigurationModal } from './components/modals/AgentConfigurationModal';
import { useRuntimeStore } from './stores/useRuntimeStore';
import { useDesignStore } from './stores/useDesignStore';
import { useFunctionStore } from './stores/useFunctionStore';
import { useWorkflowStore } from './stores/useWorkflowStore';
import { NotificationProvider } from './contexts';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { NotificationDisplay } from './components/NotificationDisplay';
import { QueryProvider } from './providers';
import { getSettingsStorage } from './utils/SettingsStorage';
// ⭐ ÉTAPE 5: Import HydrationOverlay for loading state
import { HydrationOverlay } from './components/HydrationOverlay';
// ⭐ V2: Import WorkflowSwitchOverlay for workflow switch (Bos amber)
import { WorkflowSwitchOverlay } from './components/WorkflowSwitchOverlay';
// ⭐ UX Polish: Import HyperspaceReveal for guest entry animation
import { HyperspaceReveal } from './components/HyperspaceReveal';
// ⭐ AUTO-SAVE: Import PersistenceService for immediate instance creation
import { PersistenceService } from './services/persistenceService';
import { mapPersistedChatMessages, mergePersistedAndRuntimeMessages } from './services/persistedChatMessages';
// ⭐ V2: Import apiClient for workflow switch orchestration
import apiClient from './utils/apiClient';
// ⭐ FIX QA: Import useJournalQueue for image persistence
import { useJournalQueue } from './hooks/useJournalQueue';
import { getWorkspaceSessionGateState } from './utils/workspaceSessionGate';

const RESUME_WORKSPACE_REFRESH_THROTTLE_MS = 5000;

interface EditingImageInfo {
  nodeId: string;
  sourceImage: string;
  mimeType: string;
  agent?: Agent;
  agentInstance?: AgentInstance;
}

interface DeleteConfirmationState {
  agentId: string;
  agentName: string;
}

interface UpdateConfirmationState {
  agentData: Omit<Agent, 'id'>;
  agentId: string;
  count: number;
}

interface WorkspaceSnapshot {
  workflow: {
    id: string;
    name: string;
    description?: string;
    isActive: boolean;
    isDefault: boolean;
    canvasState?: {
      zoom: number;
      panX: number;
      panY: number;
    };
  } | null;
  nodes?: any[];
  edges?: any[];
  agentInstances?: any[];
  agentPrototypes?: any[];
}

const mapPrototypeToAgent = (prototype: any, fallbackTimestamp: string): Agent => ({
  id: prototype.id || prototype._id,
  name: prototype.name,
  role: prototype.role || prototype.description || 'assistant',
  systemPrompt: prototype.systemPrompt || prototype.description || '',
  llmProvider: (prototype.provider as LLMProvider) || LLMProvider.Gemini,
  model: prototype.model || 'gemini-2.0-flash',
  capabilities: Array.isArray(prototype.capabilities) ? prototype.capabilities : [],
  tools: Array.isArray(prototype.tools) ? prototype.tools : [],
  functionIds: Array.isArray(prototype.functionIds)
    ? prototype.functionIds
    : (Array.isArray(prototype.tools)
        ? prototype.tools.map((tool: any) => tool?.toString ? tool.toString() : String(tool))
        : []),
  toolSelections: Array.isArray(prototype.toolSelections) ? prototype.toolSelections : [],
  outputConfig: prototype.outputConfig || {},
  historyConfig: prototype.historyConfig || {},
  creator_id: prototype.robotId || RobotId.Archi,
  created_at: prototype.created_at || fallbackTimestamp,
  updated_at: prototype.updated_at || fallbackTimestamp
});

const buildInstanceConfiguration = (instance: any, prototype?: Agent) => (
  instance.configuration_json || {
    role: instance.role || prototype?.role || 'assistant',
    model: instance.llmModel || instance.model || prototype?.model || 'gemini-2.0-flash',
    llmProvider: instance.llmProvider || instance.provider || prototype?.llmProvider || LLMProvider.Gemini,
    systemPrompt: instance.systemPrompt || instance.systemInstruction || prototype?.systemPrompt || '',
    capabilities: Array.isArray(instance.capabilities) ? instance.capabilities : (prototype?.capabilities || []),
    tools: Array.isArray(instance.tools) ? instance.tools : (prototype?.tools || []),
    toolSelections: Array.isArray(instance.toolSelections) ? instance.toolSelections : (prototype?.toolSelections || []),
    functionInheritance: instance.functionInheritance || undefined,
    historyConfig: instance.historyConfig || prototype?.historyConfig || {},
    outputConfig: instance.outputConfig || prototype?.outputConfig || {},
    position: instance.position || { x: 0, y: 0 }
  }
);

const mapInstanceToAgentInstance = (instance: any, workflowId?: string, prototype?: Agent): AgentInstance => ({
  id: instance.id || instance._id,
  prototypeId: instance.prototypeId || prototype?.id || instance.id || instance._id,
  name: instance.name,
  position: instance.position || instance.configuration_json?.position || { x: 0, y: 0 },
  isMinimized: instance.isMinimized || false,
  isMaximized: instance.isMaximized || false,
  workflowId: instance.workflowId || workflowId,
  persistenceConfig: instance.persistenceConfig,
  configuration_json: buildInstanceConfiguration(instance, prototype)
});

const mapInstanceToLegacyWorkflowNode = (instance: any, workflowId: string | undefined, prototype?: Agent, fallbackTimestamp?: string): WorkflowNode => {
  const timestamp = fallbackTimestamp || new Date().toISOString();
  const hydratedInstance = mapInstanceToAgentInstance(instance, workflowId, prototype);
  const hydratedAgent: Agent = prototype || {
    id: hydratedInstance.prototypeId,
    name: instance.name,
    role: hydratedInstance.configuration_json.role,
    systemPrompt: hydratedInstance.configuration_json.systemPrompt,
    llmProvider: hydratedInstance.configuration_json.llmProvider,
    model: hydratedInstance.configuration_json.model,
    capabilities: hydratedInstance.configuration_json.capabilities || [],
    tools: hydratedInstance.configuration_json.tools || [],
    historyConfig: hydratedInstance.configuration_json.historyConfig || {},
    outputConfig: hydratedInstance.configuration_json.outputConfig || {},
    creator_id: instance.robotId || RobotId.Archi,
    created_at: instance.createdAt || timestamp,
    updated_at: timestamp
  };

  return {
    id: hydratedInstance.id,
    agent: hydratedAgent,
    position: hydratedInstance.position,
    messages: [],
    isMinimized: hydratedInstance.isMinimized,
    isMaximized: hydratedInstance.isMaximized,
    instanceId: hydratedInstance.id
  };
};

const mapInstanceToV2Node = (instance: any, workflowId: string | undefined, prototype?: Agent, fallbackTimestamp?: string): V2WorkflowNode => {
  const legacyNode = mapInstanceToLegacyWorkflowNode(instance, workflowId, prototype, fallbackTimestamp);
  const hydratedInstance = mapInstanceToAgentInstance(instance, workflowId, prototype);

  return {
    id: `node-${hydratedInstance.id}`,
    type: 'agent',
    position: hydratedInstance.position,
    data: {
      robotId: legacyNode.agent.creator_id,
      label: hydratedInstance.name,
      agent: legacyNode.agent,
      agentInstance: hydratedInstance,
      workflowId,
      isMinimized: hydratedInstance.isMinimized,
      isMaximized: hydratedInstance.isMaximized
    }
  };
};

/**
 * Inner App component that uses Auth context
 * Must be wrapped by AuthProvider to access useAuth()
 */
export function AppContent() {
  const { isAuthenticated, accessToken, runtimeLLMConfigs, localLLMProfiles, user, logout, refreshRuntimeConfigState, sessionStatus, error: authError } = useAuth();
  const [isSettingsModalOpen, setSettingsModalOpen] = useState(false);
  const [isAgentModalOpen, setAgentModalOpen] = useState(false);
  const [isLoginModalOpen, setLoginModalOpen] = useState(false);
  const [isRegisterModalOpen, setRegisterModalOpen] = useState(false);
  const [isImagePanelOpen, setImagePanelOpen] = useState(false);
  const [isImageModificationPanelOpen, setImageModificationPanelOpen] = useState(false);
  const [isVideoPanelOpen, setVideoPanelOpen] = useState(false);
  const [isMapsPanelOpen, setMapsPanelOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);

  // ⭐ FIX: Store current agent for media panels - receives fresh data directly from V2AgentNode
  const [currentImageNodeId, setCurrentImageNodeId] = useState<string | null>(null);
  const [currentImageAgent, setCurrentImageAgent] = useState<Agent | null>(null);
  const [currentImageAgentInstance, setCurrentImageAgentInstance] = useState<AgentInstance | null>(null);
  const [currentVideoNodeId, setCurrentVideoNodeId] = useState<string | null>(null);
  const [currentVideoAgent, setCurrentVideoAgent] = useState<Agent | null>(null);
  const [currentVideoAgentInstance, setCurrentVideoAgentInstance] = useState<AgentInstance | null>(null);
  const [currentMapsNodeId, setCurrentMapsNodeId] = useState<string | null>(null);

  const [agents, setAgents] = useState<Agent[]>([]);
  const [workflowNodes, setWorkflowNodes] = useState<WorkflowNode[]>([]);
  const [editingImageInfo, setEditingImageInfo] = useState<EditingImageInfo | null>(null);
  const [mapsPreloadedResults, setMapsPreloadedResults] = useState<{
    text: string;
    mapSources: any[];
    query?: string;
  } | null>(null);
  const [isSidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState<{ src: string; mimeType: string } | null>(null);
  const { t } = useLocalization();

  const llmConfigs = runtimeLLMConfigs;
  const { sessionReadyForWorkspaceHydration } = getWorkspaceSessionGateState({
    isAuthenticated,
    accessToken,
    sessionStatus,
    userId: user?.id ?? null
  });

  // ⭐ ÉTAPE 5: Hydration state for authenticated users
  const [isHydrating, setIsHydrating] = useState(false);
  const [hydrationProgress, setHydrationProgress] = useState(0);
  const [hydrationMessage, setHydrationMessage] = useState('Chargement de votre workspace...');
  
  // ⭐ V2: Flag to distinguish initial login hydration from user-initiated workflow switch
  // isInitialHydrationRef removed (was dead code — never read)

  // ⭐ V2: State dédié au switch overlay (séparé de l'hydratation login)
  const [isSwitchingWorkflow, setIsSwitchingWorkflow] = useState(false);
  const [switchWorkflowName, setSwitchWorkflowName] = useState('');
  const [switchProgress, setSwitchProgress] = useState(0);
  const isSwitchingRef = useRef(false);  // Guard anti-re-entrance (pas de useState pour éviter re-render)
  const isHydratingRef = useRef(false);
  const workspaceReloadPromiseRef = useRef<Promise<void> | null>(null);
  const hydratedWorkspaceIdentityRef = useRef<string | null>(null);
  const lastResumeWorkspaceRefreshAtRef = useRef(0);

  // ⭐ UX Polish: Hyperspace animation state for guests
  // Shows when: first load as guest OR after logout
  const [showHyperspace, setShowHyperspace] = useState(!isAuthenticated);
  const [hyperspaceActive, setHyperspaceActive] = useState(false);
  const wasAuthenticatedRef = React.useRef(isAuthenticated);
  
  // ⭐ UX: Trigger hyperspace on logout (auth → guest transition)
  useEffect(() => {
    const wasAuth = wasAuthenticatedRef.current;
    wasAuthenticatedRef.current = isAuthenticated;

    // Transition: authenticated → guest (logout)
    if (wasAuth && !isAuthenticated) {
      setShowHyperspace(true);
      setHyperspaceActive(false); // Reset to idle
    }
  }, [isAuthenticated]);

  // ⭐ UX: Auto-trigger warp after short delay when hyperspace is shown
  useEffect(() => {
    if (showHyperspace && !hyperspaceActive) {
      const timer = setTimeout(() => {
        setHyperspaceActive(true);
      }, 1500); // 1.5s idle phase before warp
      return () => clearTimeout(timer);
    }
  }, [showHyperspace, hyperspaceActive]);

  // ⭐ UX: Handle hyperspace animation complete
  const handleHyperspaceComplete = useCallback(() => {
    // Small delay to ensure smooth transition
    setTimeout(() => {
      setShowHyperspace(false);
      setHyperspaceActive(false);
    }, 100);
  }, []);

  // Runtime Store access
  const { updateLLMConfigs, updateLocalLLMProfiles, setNavigationHandler, addNodeMessage } = useRuntimeStore();

  // Design Store access for integrity validation  
  const { validateWorkflowIntegrity, cleanupOrphanedInstances, addAgentInstance, deleteNode, deleteAgentInstance, hydrateFromServer, updateInstanceId, addNode, agentInstances, nodes: storeNodes } = useDesignStore();
  
  // ⭐ SELF-HEALING: Workflow Store for hydrating workflow ID
  const { hydrateWorkflowFromServer, getCurrentWorkflowId } = useWorkflowStore();
  
  // ⭐ FIX QA: Journal queue for persisting generated images
  const { enqueueEntry: enqueueJournalEntry } = useJournalQueue();

  useEffect(() => {
    isHydratingRef.current = isHydrating;
  }, [isHydrating]);

  const clearTransientUiState = useCallback(() => {
    setWorkflowNodes([]);
    setAgents([]);
    setImagePanelOpen(false);
    setCurrentImageNodeId(null);
    setCurrentImageAgent(null);
    setCurrentImageAgentInstance(null);
    setImageModificationPanelOpen(false);
    setEditingImageInfo(null);
    setVideoPanelOpen(false);
    setCurrentVideoNodeId(null);
    setCurrentVideoAgent(null);
    setCurrentVideoAgentInstance(null);
    setMapsPanelOpen(false);
    setCurrentMapsNodeId(null);
    setMapsPreloadedResults(null);
  }, []);

  const applyWorkspaceSnapshot = useCallback((workspace: WorkspaceSnapshot, options?: { preserveRuntimeMessages?: boolean }) => {
    const snapshotWorkflowId = workspace.workflow?.id;
    const fallbackTimestamp = new Date().toISOString();
    const rawPrototypes = Array.isArray(workspace.agentPrototypes) ? workspace.agentPrototypes : [];
    const rawInstances = Array.isArray(workspace.agentInstances) ? workspace.agentInstances : [];
    const prototypeIndex = new Map<string, Agent>();
    const hydratedPrototypes = rawPrototypes.map((prototype: any) => {
      const hydratedPrototype = mapPrototypeToAgent(prototype, fallbackTimestamp);
      prototypeIndex.set(hydratedPrototype.id, hydratedPrototype);
      return hydratedPrototype;
    });
    const hydratedInstances = rawInstances.map((instance: any) => {
      const prototype = prototypeIndex.get(instance.prototypeId);
      return mapInstanceToAgentInstance(instance, snapshotWorkflowId, prototype);
    });
    const v2Nodes = rawInstances.map((instance: any) => {
      const prototype = prototypeIndex.get(instance.prototypeId);
      return mapInstanceToV2Node(instance, snapshotWorkflowId, prototype, fallbackTimestamp);
    });
    const legacyNodes = rawInstances.map((instance: any) => {
      const prototype = prototypeIndex.get(instance.prototypeId);
      return mapInstanceToLegacyWorkflowNode(instance, snapshotWorkflowId, prototype, fallbackTimestamp);
    });

    if (workspace.workflow) {
      hydrateWorkflowFromServer({
        id: workspace.workflow.id,
        name: workspace.workflow.name,
        description: workspace.workflow.description,
        isDefault: workspace.workflow.isDefault,
        isActive: workspace.workflow.isActive,
        canvasState: workspace.workflow.canvasState
      });
    }

    useDesignStore.getState().setCurrentWorkflowId(snapshotWorkflowId || null);
    hydrateFromServer({
      agents: hydratedPrototypes,
      agentInstances: hydratedInstances,
      nodes: v2Nodes,
      edges: Array.isArray(workspace.edges) ? workspace.edges : []
    });
    void useFunctionStore.getState().loadFunctions(snapshotWorkflowId || undefined);

    setAgents(hydratedPrototypes);
    setWorkflowNodes(legacyNodes);

    const { setNodeMessages, getNodeMessages } = useRuntimeStore.getState();
    for (const instance of rawInstances) {
      const instanceId = instance.id || instance._id;
      if (!instanceId) {
        continue;
      }
      const nodeId = `node-${instanceId}`;
      const persistedMessages = mapPersistedChatMessages(instance.chatMessages);
      const nextMessages = options?.preserveRuntimeMessages
        ? mergePersistedAndRuntimeMessages(persistedMessages, getNodeMessages(nodeId))
        : persistedMessages;
      setNodeMessages(nodeId, nextMessages);
    }

    console.log('[App] Workspace snapshot applied:', {
      workflowId: snapshotWorkflowId,
      prototypes: hydratedPrototypes.length,
      instances: hydratedInstances.length,
      edges: Array.isArray(workspace.edges) ? workspace.edges.length : 0
    });
  }, [hydrateFromServer, hydrateWorkflowFromServer]);

  const reloadWorkspaceSnapshot = useCallback(async ({
    reason,
    mode,
  }: {
    reason: string;
    mode: 'initial-auth' | 'resume';
  }) => {
    if (!isAuthenticated || !sessionReadyForWorkspaceHydration || !user?.id) {
      return;
    }

    if (workspaceReloadPromiseRef.current) {
      return workspaceReloadPromiseRef.current;
    }

    const reloadPromise = (async () => {
      const showOverlay = mode === 'initial-auth';

      if (showOverlay) {
        setHydrationMessage('Chargement de votre workspace...');
        setIsHydrating(true);
        setHydrationProgress(10);
      }

      try {
        if (mode === 'initial-auth') {
          useDesignStore.getState().resetAll();
          useRuntimeStore.getState().resetForWorkflowSwitch();

          const allGuestKeys = getAllGuestKeys();
          allGuestKeys.forEach(key => localStorage.removeItem(key));

          sessionStorage.clear();
          sessionStorage.setItem('_arc_hydrating', 'true');
          setHydrationProgress(30);
        }

        if (showOverlay) {
          setHydrationProgress(60);
        }

        const { data: workspace } = await apiClient.get('/api/user/workspace');

        if (showOverlay) {
          setHydrationProgress(80);
        }

        applyWorkspaceSnapshot(workspace, {
          preserveRuntimeMessages: mode === 'resume'
        });
        hydratedWorkspaceIdentityRef.current = `auth:${user.id}`;

        console.log('[App] Workspace reload complete:', {
          reason,
          mode,
          userId: user.id,
        });
      } catch (err) {
        console.error('[App] Workspace hydration error:', err);
        if (showOverlay) {
          setHydrationMessage(authError || 'Restauration de session impossible. Reconnexion requise.');
        }
      } finally {
        if (showOverlay) {
          setTimeout(() => {
            setIsHydrating(false);
            setHydrationProgress(0);
            sessionStorage.removeItem('_arc_hydrating');
          }, 500);
        }
      }
    })().finally(() => {
      workspaceReloadPromiseRef.current = null;
    });

    workspaceReloadPromiseRef.current = reloadPromise;
    return reloadPromise;
  }, [applyWorkspaceSnapshot, authError, isAuthenticated, sessionReadyForWorkspaceHydration, user?.id]);

  /**
   * ⭐ ÉTAPE 5: Hydration for authenticated users
   * Fetches workspace data from GET /api/user/workspace and populates stores
   */
  useEffect(() => {
    if (!isAuthenticated) {
      hydratedWorkspaceIdentityRef.current = null;
      setIsHydrating(false);
      sessionStorage.removeItem('_arc_hydrating');
      return;
    }

    if (!sessionReadyForWorkspaceHydration || !user?.id) {
      return;
    }

    const currentIdentity = `auth:${user.id}`;
    if (hydratedWorkspaceIdentityRef.current === currentIdentity) {
      return;
    }

    void reloadWorkspaceSnapshot({
      reason: 'initial-auth-hydration',
      mode: 'initial-auth',
    });
  }, [isAuthenticated, reloadWorkspaceSnapshot, sessionReadyForWorkspaceHydration, user?.id]);

  useEffect(() => {
    if (!sessionReadyForWorkspaceHydration || !user?.id) {
      return;
    }

    const requestResumeWorkspaceRefresh = (reason: string) => {
      const now = Date.now();

      if (isHydratingRef.current || isSwitchingRef.current) {
        return;
      }

      if (now - lastResumeWorkspaceRefreshAtRef.current < RESUME_WORKSPACE_REFRESH_THROTTLE_MS) {
        return;
      }

      lastResumeWorkspaceRefreshAtRef.current = now;

      void (async () => {
        try {
          await refreshRuntimeConfigState();
        } catch (err) {
          console.warn('[App] Runtime config refresh failed during resume:', err);
        }

        await reloadWorkspaceSnapshot({
          reason,
          mode: 'resume',
        });
      })();
    };

    const handleFocus = () => requestResumeWorkspaceRefresh('window-focus');
    const handleOnline = () => requestResumeWorkspaceRefresh('network-online');
    const handlePageShow = () => requestResumeWorkspaceRefresh('page-show');
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        requestResumeWorkspaceRefresh('visibility-visible');
      }
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('online', handleOnline);
    window.addEventListener('pageshow', handlePageShow);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('pageshow', handlePageShow);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshRuntimeConfigState, reloadWorkspaceSnapshot, sessionReadyForWorkspaceHydration, user?.id]);

  /**
   * ⭐ V2 SWITCH WORKFLOW: Fonction unifiée de réhydratation complète
   * Orchestre le switch de workflow avec feedback UX (WorkflowSwitchOverlay jaune Bos)
   * 
   * ⭐ V2 RÉÉCRITURE COMPLÈTE — Corrige P0-1, P0-2, P0-3, P2-1
   * 
   * SÉQUENCE:
   * 0. Guard clauses (anti-re-entrance, auth, hydration)
   * 1. Reset runtime store → nettoyer chat/execution du workflow précédent
   * 2. Fetch les données du workflow via POST /select (avec agentPrototypes)
   * 3. Mapper les prototypes (copie exacte de l'hydratation initiale L310-329)
   * 4. Hydratation atomique → hydrateFromServer + setAgents + hydrateWorkflowFromServer
   * 5. Recharger les journals → restaurer l'historique chat
   * 6. Reconstruire le React state legacy → workflowNodes pour le canvas
   * 7. Refresh liste workflows
   * 8. Succès → événement + notification
   */
  const switchToWorkflow = useCallback(async (workflowId: string, workflowName?: string) => {
    // ═══ ÉTAPE 0 : GUARD CLAUSES ═══
    if (isSwitchingRef.current) {
      console.warn('[SwitchWorkflow] ⚠️ Switch already in progress, ignoring');
      return;
    }
    if (isHydrating) {
      console.warn('[SwitchWorkflow] ⚠️ Initial hydration in progress, ignoring');
      return;
    }
    if (!accessToken) {
      console.warn('[SwitchWorkflow] ⚠️ No accessToken — aborting switch');
      window.dispatchEvent(new CustomEvent('workflow:switch:error', {
        detail: { message: t('workflow_switch_error_message').replace('{name}', workflowName || '') }
      }));
      return;
    }

    isSwitchingRef.current = true;
    setIsSwitchingWorkflow(true);
    setSwitchWorkflowName(workflowName || 'Workflow');
    setSwitchProgress(0);
    
    console.log('[SwitchWorkflow] ⭐ Starting full workflow switch to:', workflowId, workflowName);
    
    try {
      // ═══ ÉTAPE 1 : RESET RUNTIME (progress 10%) ═══
      // ⭐ V2 FIX: Use resetForWorkflowSwitch() to PRESERVE llmConfigs (user-level, not workflow-scoped)
      setSwitchProgress(10);
      useRuntimeStore.getState().resetForWorkflowSwitch();
      
      // ═══ ÉTAPE 2 : APPEL API (progress 30%) ═══
      setSwitchProgress(30);
      const { data } = await apiClient.post(`/api/workflows/${workflowId}/select`);

      if (!data.success) {
        throw new Error(data.message || 'Switch failed');
      }
      // ═══ ÉTAPE 3 : APPLIQUER LE SNAPSHOT (progress 70%) ═══
      setSwitchProgress(70);
      applyWorkspaceSnapshot(data.reloadedData, {
        preserveRuntimeMessages: false
      });

      // ═══ ÉTAPE 4 : REFRESH LISTE WORKFLOWS (progress 95%) ═══
      setSwitchProgress(95);
      try {
        await useDesignStore.getState().loadUserWorkflows();
      } catch (refreshErr) {
        console.warn('[SwitchWorkflow] Workflows list refresh failed (non-blocking):', refreshErr);
      }

      // ═══ ÉTAPE 8 : SUCCÈS (progress 100%) ═══
      setSwitchProgress(100);
      
      console.log('[SwitchWorkflow] ✅ Workflow switch complete:', {
        workflowId,
        workflowName,
        prototypesCount: Array.isArray(data.reloadedData?.agentPrototypes) ? data.reloadedData.agentPrototypes.length : 0,
        instancesCount: Array.isArray(data.reloadedData?.agentInstances) ? data.reloadedData.agentInstances.length : 0
      });
      
      // ⭐ V2: Notify observers of successful switch
      window.dispatchEvent(new CustomEvent('workflow:switch:success', {
        detail: { workflowId, workflowName }
      }));
      
    } catch (error: any) {
      console.error('[SwitchWorkflow] ❌ Error:', error);
      window.dispatchEvent(new CustomEvent('workflow:switch:error', {
        detail: { message: error.message || 'Unknown error', workflowId }
      }));
    } finally {
      // ═══ CLEANUP ═══
      setTimeout(() => {
        setIsSwitchingWorkflow(false);
        setSwitchProgress(0);
        setSwitchWorkflowName('');
      }, 300);
      isSwitchingRef.current = false;
    }
  }, [accessToken, applyWorkspaceSnapshot, t, isHydrating]);

  /**
   * ⭐ V2: Listen for workflow:switch custom events from BosWorkflowManagementPage
   * Pattern Observer — découplage entre la page BOS et l'orchestration App.tsx
   */
  useEffect(() => {
    const handleWorkflowSwitch = (event: Event) => {
      const { workflowId, workflowName } = (event as CustomEvent).detail;
      if (workflowId) {
        switchToWorkflow(workflowId, workflowName || 'Workflow');
      }
    };
    
    window.addEventListener('workflow:switch', handleWorkflowSwitch);
    return () => window.removeEventListener('workflow:switch', handleWorkflowSwitch);
  }, [switchToWorkflow]);

  /**
   * ⭐ CRITICAL J4.4: Strong-clean state on auth change (login/logout)
   * ONLY handles non-llmConfigs cleanup
   * llmConfigs hydration is now handled by the unified effect below
   */
  const previousStableUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const stableUserId = isAuthenticated ? (user?.id ?? null) : null;
    const previousStableUserId = previousStableUserIdRef.current;
    previousStableUserIdRef.current = stableUserId;

    if (previousStableUserId === undefined || previousStableUserId === stableUserId) {
      return;
    }

    clearTransientUiState();
  }, [clearTransientUiState, isAuthenticated, user?.id]);

  useEffect(() => {
    updateLLMConfigs(llmConfigs);
  }, [llmConfigs, updateLLMConfigs]);

  // ⭐ NEW: Sync local LLM profiles into runtime store
  useEffect(() => {
    updateLocalLLMProfiles(localLLMProfiles);
  }, [localLLMProfiles, updateLocalLLMProfiles]);

  // ⭐ PHASE 2: Load workflows on authentication
  // ⭐ V4 FIX: Wait for hydration to complete before loading workflows
  // The hydration useEffect sets _arc_hydrating flag; we wait until it's cleared.
  useEffect(() => {
    if (!sessionReadyForWorkspaceHydration) return;

    const loadWorkflows = async (retryCount = 0) => {
      try {
        // Wait for hydration to finish before loading workflows
        const isHydrating = sessionStorage.getItem('_arc_hydrating') === 'true';
        if (isHydrating && retryCount < 5) {
          // Hydration still in progress — retry after 300ms
          setTimeout(() => loadWorkflows(retryCount + 1), 300);
          return;
        }
        
        const designStore = useDesignStore.getState();
        await designStore.loadUserWorkflows();
        console.log('[App] ✅ Workflows loaded successfully');
      } catch (error) {
        console.error('[App] ❌ Failed to load workflows:', error);
        // Error is already in store.workflowLoadError
      }
    };

    // Load after initial hydration settles
    const timer = setTimeout(() => {
      loadWorkflows();
    }, 200);

    return () => clearTimeout(timer);
  }, [sessionReadyForWorkspaceHydration, user?.id]);

  // ⭐ V2: L'ancien watcher PHASE 2 (resetAll sur currentWorkflowId change) est supprimé.
  // switchToWorkflow() orchestre désormais le reset + rechargement complet.
  // Garder le watcher causerait un double reset du runtimeStore.

  // Configure navigation handler for agent nodes
  useEffect(() => {
    setNavigationHandler(handleRobotNavigation);
  }, [setNavigationHandler]);

  // PHASE 1B: Integrity validation on app startup + Migration legacy nodes
  useEffect(() => {
    // Clean up any orphaned instances first
    const cleanedCount = cleanupOrphanedInstances();

    // Then validate workflow integrity
    const { fixedCount } = validateWorkflowIntegrity();

    // 🆕 Migration: Créer des instances pour les nodes legacy sans instanceId
    let migratedCount = 0;
    const currentWorkflowId = getCurrentWorkflowId(); // ⭐ Get current workflow ID for migration
    const updatedNodes = workflowNodes.map(node => {
      if (!node.instanceId && node.agent) {
        // Créer une instance pour ce node legacy - pass workflowId
        const instanceId = addAgentInstance(node.agent.id, node.position, node.agent.name, currentWorkflowId || undefined);
        migratedCount++;
        return { ...node, instanceId };
      }
      return node;
    });

    if (migratedCount > 0) {
      setWorkflowNodes(updatedNodes);
      console.log(`🔄 Migrated ${migratedCount} legacy nodes to instance architecture`);
    }

    if (cleanedCount > 0 || fixedCount > 0) {
      console.log(`🚀 App startup integrity check completed: cleaned ${cleanedCount} instances, fixed ${fixedCount} nodes`);
    }
  }, []); // Run only once on mount

  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmationState | null>(null);
  const [updateConfirmation, setUpdateConfirmation] = useState<UpdateConfirmationState | null>(null);

  // Robot Navigation State
  const [currentPath, setCurrentPath] = useState('/bos/dashboard');

  const handleRobotNavigation = (robotId: RobotId, path: string) => {
    setCurrentPath(path);
    // TODO: Implement proper routing logic
    console.log(`Navigating to robot ${robotId} at path ${path}`);
  };

  const handleSaveAgent = async (agentData: Omit<Agent, 'id'>, agentId?: string) => {
    try {
      let backendId: string;
      let savedAgent: any;

      if (agentId) {
        // ⭐ ÉTAPE 3: Update existing agent prototype
        console.log('[App] 📤 Updating agent prototype:', agentId);
        const { data: updatedAgent } = await apiClient.put(`/api/agent-prototypes/${agentId}`, agentData);

        savedAgent = updatedAgent;
        backendId = savedAgent._id || agentId;
        console.log('[App] ✅ Agent prototype updated:', backendId);
      } else {
        // ⭐ ÉTAPE 3: Create new agent prototype
        console.log('[App] 📤 Creating new agent prototype:', agentData.name);
        const { data: createdAgent } = await apiClient.post('/api/agent-prototypes', agentData);

        savedAgent = createdAgent;
        backendId = savedAgent._id;
        console.log('[App] ✅ Agent prototype created with backendId:', backendId);

        // ⭐ ÉTAPE 3 CRITICAL: Convert tempId → backendId for NEW agents
        // Find which agent in the store has the same name/role and convert its ID
        if (!agentId && backendId) {
          const storeState = useDesignStore.getState();
          // Look for agent with matching name and role (since we just created it with tempId)
          const tempAgent = storeState.agents.find(
            a => a.name === agentData.name && a.role === agentData.role
          );

          if (tempAgent && tempAgent.id !== backendId) {
            console.log('[App] ⭐ Converting tempId → backendId:', {
              tempId: tempAgent.id,
              backendId: backendId
            });
            // This also updates all instances referencing this prototype
            useDesignStore.getState().updateAgentId(tempAgent.id, backendId);
          }
        }
      }

      // Close the modal
      setAgentModalOpen(false);
      setEditingAgent(null);

      // Show success notification
      console.log('[App] ✅ Agent saved successfully:', backendId);
    } catch (error) {
      console.error('[App] ❌ Error saving agent:', error);
      // TODO: Show error notification to user
    }
  };

  const handleSaveSettings = async (_newLLMConfigs: LLMConfig[]) => {
    try {
      // Get appropriate storage based on auth state
      const storage = getSettingsStorage({
        isAuthenticated,
        accessToken,
        refreshToken: null,
        user,
        runtimeLLMConfigs: llmConfigs,
        localLLMProfiles,
        login: async () => { },
        register: async () => { },
        logout,
        refreshAccessToken: async () => { },
        clearError: () => { },
        refreshLLMApiKeys: async () => { },
        llmApiKeys: null,
        refreshRuntimeConfigState,
        isLoading: false,
        error: null
      });

      // NOTE J4.4: LLMConfigs are now managed separately via useLLMConfigs hook
      // We only save PREFERENCES here (language, theme)
      // LLMConfigs should be saved via LLMConfigModal -> useLLMConfigs -> updateConfig()
      
      // Save preferences only
      await storage.saveSettings({
        preferences: { language: 'fr' }
      });
      
      await refreshRuntimeConfigState();
    } catch (error) {
      console.error('[App] handleSaveSettings error:', error);
    }
  };

  const handleUpdateConfirmation = (updateInstances: boolean) => {
    if (updateConfirmation) {
      const { agentData, agentId } = updateConfirmation;
      const updatedAgent = { ...agentData, id: agentId };

      // Update the prototype agent
      setAgents(prev => prev.map(a => a.id === agentId ? updatedAgent : a));

      if (updateInstances) {
        setWorkflowNodes(prev => prev.map(node =>
          node.agent.id === agentId
            ? { ...node, agent: updatedAgent }
            : node
        ));
      }
    }
    setUpdateConfirmation(null);
  };

  const handleDeleteAgent = (agentId: string) => {
    const agentToDelete = agents.find(agent => agent.id === agentId);
    if (agentToDelete) {
      setDeleteConfirmation({ agentId, agentName: agentToDelete.name });
    }
  };

  const confirmDeleteAgent = () => {
    if (deleteConfirmation) {
      const { agentId } = deleteConfirmation;
      // ⭐ FIX: Close modal IMMEDIATELY before performing deletion to prevent double-click
      // This prevents event bubbling from re-triggering the delete button
      setDeleteConfirmation(null);
      
      // Then perform the actual deletion
      setAgents(prev => prev.filter(agent => agent.id !== agentId));
      setWorkflowNodes(prev => prev.filter(node => node.agent.id !== agentId));
    }
  };

  const handleOpenEditAgentModal = (agent: Agent) => {
    setEditingAgent(agent);
    setAgentModalOpen(true);
  };

  /**
   * ⭐ AUTO-SAVE: Add agent to workflow with immediate API persistence
   * 
   * Per Dev_rules.md: Agent instances are ALWAYS auto-saved (independent of workflow save mode)
   * This ensures the agent_instances collection is populated immediately on creation.
   */
  const addAgentToWorkflow = useCallback(async (agent: Agent) => {
    // ⭐ BUG FIX: Calculate position based on STORE instances (not legacy workflowNodes)
    // This prevents collision when reconnecting (workflowNodes is empty on load)
    // Use getState() to get current count of instances in Zustand store
    const storeInstances = useDesignStore.getState().agentInstances;
    const instanceCount = storeInstances.length;
    
    const position = {
      x: (instanceCount % 4) * 420 + 20,
      y: Math.floor(instanceCount / 4) * 540 + 20,
    };

    // Use instanceName if provided, otherwise use agent name
    const instanceName = agent.instanceName || agent.name;

    // ⭐ Get workflowId BEFORE creating instance
    const workflowId = getCurrentWorkflowId();

    // Add agent instance to DesignStore with custom instance name and workflowId
    const instanceId = addAgentInstance(agent.id, position, instanceName, workflowId || undefined);

    // ⭐ AUTO-SAVE: Immediately persist to backend (if authenticated)
    if (isAuthenticated && accessToken && workflowId) {
      console.log('[App] 📤 Auto-saving new agent instance to backend:', {
        instanceId,
        prototypeId: agent.id,
        workflowId
      });
      
      const result = await PersistenceService.createAgentInstance(
        {
          id: instanceId,
          prototypeId: agent.id,
          name: instanceName,
          position,
          configuration_json: {
            role: agent.role,
            model: agent.model,
            llmProvider: agent.llmProvider,
            systemPrompt: agent.systemPrompt,
            tools: agent.tools || [],
            outputConfig: agent.outputConfig,
            // ⭐ PHASE 2: Include capabilities + historyConfig for complete persistence
            // Ensures reconnection loads same capabilities as template
            // Chat is ALWAYS included as the minimum capability
            capabilities: agent.capabilities && agent.capabilities.length > 0 
              ? agent.capabilities 
              : [LLMCapability.Chat],  // Fallback: minimum Chat capability
            // Include history config if template defined it
            historyConfig: agent.historyConfig || undefined
          },
          // ⭐ Pass persistenceConfig override if provided from WorkflowValidationModal
          persistenceConfig: agent.persistenceConfig
        },
        workflowId,
        { isAuthenticated, accessToken }
      );
      
      // ⭐ FIX: Utiliser le backendId comme ID final, sinon le tempId
      let finalInstanceId = instanceId;
      
      if (result.success) {
        console.log('[App] ✅ Agent instance persisted to DB with backendId:', result.backendId);
        
        // ✅ ÉTAPE 2: Synchroniser l'instance complète du backend avec Zustand
        // Le backend retourne l'instance avec configuration_json enrichie
        if (result.backendId && result.instance) {
          
          // ✅ Remplacer l'instance temporaire par l'instance backend complète
          // Incluant la configuration_json qui sera utilisée dans AgentConfigurationModal
          const backendInstance: AgentInstance = {
            id: result.backendId,
            prototypeId: agent.id,
            name: instanceName,
            position,
            workflowId,
            isMinimized: false,
            isMaximized: false,
            // ⭐ FIX QA: Récupérer persistenceConfig du backend ou du prototype
            persistenceConfig: result.instance.persistenceConfig || agent.persistenceConfig || {
              saveChat: true,
              saveErrors: true,
              saveHistorySummary: false,
              saveLinks: false,
              saveTasks: false,
              saveMedia: false,
              mediaStorage: 'db'
            },
            // ✅ configuration_json contient TOUS les détails de config (role, model, llmProvider, etc.)
            configuration_json: result.instance.configuration_json || {
              role: agent.role,
              model: agent.model,
              llmProvider: agent.llmProvider,
              systemPrompt: agent.systemPrompt,
              tools: agent.tools || [],
              outputConfig: agent.outputConfig,
              capabilities: agent.capabilities || [],
              historyConfig: agent.historyConfig,
              position
            }
          };
          
          // ✅ CRITICAL: Update instance ID AND content in Zustand store
          if (result.backendId !== instanceId) {
            updateInstanceId(instanceId, result.backendId);
          }
          // ✅ Ensuite mettre à jour la configuration complète
          // Use getState() for stable reference (avoid dependency on updateAgentInstance)
          useDesignStore.getState().updateAgentInstance(result.backendId, backendInstance);
          finalInstanceId = result.backendId;
        }
      } else {
        console.error('[App] ❌ Failed to persist agent instance:', result.error);
        // Don't block UI - instance exists locally, will sync later
      }
      
      // ⭐ CRITICAL: Create V2WorkflowNode in Zustand store AFTER ID resolution
      // ⭐ FIX: Utiliser getState() pour obtenir la valeur actuelle du store (pas la closure stale)
      const currentAgentInstances = useDesignStore.getState().agentInstances;
      
      const updatedInstance = currentAgentInstances.find(inst => 
        inst.id === finalInstanceId || inst.id === instanceId
      );
      
      if (updatedInstance) {
        // ⭐ FIX: Ensure workflowId is set on the instance
        const instanceWithWorkflowId: AgentInstance = {
          ...updatedInstance,
          id: finalInstanceId, // ⭐ Forcer l'utilisation de l'ID final
          workflowId: updatedInstance.workflowId || workflowId
        };
        
        addNode({
          type: 'agent',
          position,
          data: {
            robotId: RobotId.Archi,
            label: instanceName,
            agent,
            agentInstance: instanceWithWorkflowId,
            workflowId,
            isMinimized: false,
            isMaximized: false
          }
        });
      } else {
        console.warn('[App] ⚠️ Instance not found after creation, creating node anyway');
        // Créer le node avec les données disponibles
        addNode({
          type: 'agent',
          position,
          data: {
            robotId: RobotId.Archi,
            label: instanceName,
            agent,
            agentInstance: {
              id: finalInstanceId,
              prototypeId: agent.id,
              name: instanceName,
              position,
              isMinimized: false,
              isMaximized: false,
              workflowId,
              configuration_json: null
            },
            workflowId,
            isMinimized: false,
            isMaximized: false
          }
        });
      }
      
      // Legacy: Also add to local state with the final ID
      const newNode: WorkflowNode = {
        id: `node-${Date.now()}`,
        agent,
        position,
        messages: [],
        isMinimized: false,
        isMaximized: false,
        instanceId: finalInstanceId // ⭐ Utiliser l'ID final
      };
      setWorkflowNodes(prev => [...prev, newNode]);
    } else {
      console.log('[App] Guest mode - agent instance saved to localStorage via store');
      
      // Guest mode: créer le node avec l'ID local
      // ⭐ FIX: Utiliser getState() pour obtenir la valeur actuelle du store
      const guestAgentInstances = useDesignStore.getState().agentInstances;
      const localInstance = guestAgentInstances.find(inst => inst.id === instanceId);
      if (localInstance) {
        addNode({
          type: 'agent',
          position,
          data: {
            robotId: RobotId.Archi,
            label: instanceName,
            agent,
            agentInstance: { ...localInstance, workflowId: localInstance.workflowId || 'guest-workflow' },
            workflowId: 'guest-workflow',
            isMinimized: false,
            isMaximized: false
          }
        });
      }
      
      // Legacy state
      const newNode: WorkflowNode = {
        id: `node-${Date.now()}`,
        agent,
        position,
        messages: [],
        isMinimized: false,
        isMaximized: false,
        instanceId
      };
      setWorkflowNodes(prev => [...prev, newNode]);
    }
  }, [workflowNodes, addAgentInstance, isAuthenticated, accessToken, getCurrentWorkflowId, updateInstanceId, addNode, agentInstances]);

  /**
   * ⭐ FIX: Suppression robuste d'un node avec persistance backend
   * Gère les deux formats d'ID (legacy et V2)
   */
  const handleDeleteNode = useCallback(async (nodeId: string) => {
    console.log('[App] handleDeleteNode called with:', nodeId);
    
    // 1. Trouver le node dans le state legacy pour obtenir l'instanceId
    const legacyNode = workflowNodes.find(node => node.id === nodeId);
    const instanceId = legacyNode?.instanceId;
    
    // 2. Trouver le node V2 dans le store (format: node-{instanceId})
    const v2NodeId = instanceId ? `node-${instanceId}` : nodeId;
    const v2Node = storeNodes.find(node => node.id === v2NodeId || node.id === nodeId);
    const v2InstanceId = v2Node?.data?.agentInstance?.id;
    
    // Déterminer l'ID d'instance final
    const finalInstanceId = instanceId || v2InstanceId;
    
    console.log('[App] Delete node resolution:', { 
      nodeId, 
      legacyInstanceId: instanceId, 
      v2NodeId, 
      v2InstanceId,
      finalInstanceId 
    });
    
    // 3. Supprimer du state legacy
    setWorkflowNodes(prev => prev.filter(node => node.id !== nodeId));
    
    // 4. Supprimer du store Zustand (essayer les deux formats d'ID)
    deleteNode(nodeId);
    deleteNode(v2NodeId);
    
    // 5. Supprimer l'instance du store si trouvée
    if (finalInstanceId) {
      deleteAgentInstance(finalInstanceId);
      
      // 6. ⭐ CRITICAL: Persister la suppression au backend
      if (isAuthenticated) {
        const workflowId = getCurrentWorkflowId();
        if (workflowId) {
          try {
            await apiClient.delete(`/api/workflows/${workflowId}/instances/${finalInstanceId}`);
            console.log('[App] ✅ Agent instance deleted from backend:', finalInstanceId);
          } catch (error) {
            console.error('[App] ❌ Error deleting instance from backend:', error);
          }
        }
      }
    }
  }, [workflowNodes, storeNodes, deleteNode, deleteAgentInstance, isAuthenticated, accessToken, getCurrentWorkflowId]);

  const handleDeleteNodes = useCallback(async (instanceIds: string[]) => {
    // Batch delete multiple nodes by instanceId (used when deleting prototype with instances)
    console.log('[App] handleDeleteNodes called with:', instanceIds);
    
    // 1. Supprimer du state legacy
    setWorkflowNodes(prev => prev.filter(node => !node.instanceId || !instanceIds.includes(node.instanceId)));
    
    // 2. Supprimer du store et backend pour chaque instance
    for (const instanceId of instanceIds) {
      // Supprimer du store
      deleteNode(`node-${instanceId}`);
      deleteAgentInstance(instanceId);
      
      // Persister au backend
      if (isAuthenticated) {
        const workflowId = getCurrentWorkflowId();
        if (workflowId) {
          try {
            await apiClient.delete(`/api/workflows/${workflowId}/instances/${instanceId}`);
          } catch (error) {
            console.error('[App] Error deleting instance:', instanceId, error);
          }
        }
      }
    }
  }, [deleteNode, deleteAgentInstance, isAuthenticated, accessToken, getCurrentWorkflowId]);

  const handleUpdateNodePosition = (nodeId: string, position: { x: number; y: number }) => {
    setWorkflowNodes(prev =>
      prev.map(node => (node.id === nodeId ? { ...node, position } : node))
    );
  };

  const handleToggleNodeMaximize = (nodeId: string) => {
    setWorkflowNodes(prev =>
      prev.map(node => {
        // Si c'est le node ciblé, inverser son état isMaximized
        if (node.id === nodeId) {
          return { ...node, isMaximized: !node.isMaximized };
        }
        // Forcer tous les autres nodes à isMaximized: false (un seul à la fois)
        return { ...node, isMaximized: false };
      })
    );
  };

  const handleOpenImagePanel = (nodeId: string, agent: Agent, agentInstance: AgentInstance) => {
    setCurrentImageNodeId(nodeId);
    setCurrentImageAgent(agent);
    setCurrentImageAgentInstance(agentInstance);
    setImagePanelOpen(true);
  };

  const handleImageGenerated = (nodeId: string, imageBase64: string) => {
    const imageMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'agent',
      text: t('app_generatedImageText'),
      image: imageBase64,
      mimeType: 'image/png',
      timestamp: new Date()
    };
    handleUpdateNodeMessages(nodeId, prev => [...prev, imageMessage]);
    addNodeMessage(nodeId, imageMessage);
    
    // ⭐ FIX QA: Persist generated image to journal
    const instanceId = nodeId.replace('node-', '');
    const workflowId = getCurrentWorkflowId();
    if (instanceId && workflowId) {
      enqueueJournalEntry(workflowId, instanceId, 'chat', {
        role: 'agent',
        content: t('app_generatedImageText'),
        imageBase64: imageBase64,
        mimeType: 'image/png'
      });
    }
  };

  const handleOpenImageModificationPanel = (nodeId: string, sourceImage: string, agent?: Agent, agentInstance?: AgentInstance, mimeType: string = 'image/png') => {
    setEditingImageInfo({ nodeId, sourceImage, mimeType, agent, agentInstance });
    setImageModificationPanelOpen(true);
  };

  const handleOpenVideoPanel = (nodeId: string, agent: Agent, agentInstance: AgentInstance) => {
    setCurrentVideoNodeId(nodeId);
    setCurrentVideoAgent(agent);
    setCurrentVideoAgentInstance(agentInstance);
    setVideoPanelOpen(true);
  };

  const handleOpenMapsPanel = (nodeId: string, preloadedResults?: { text: string; mapSources: any[]; query?: string }) => {
    setCurrentMapsNodeId(nodeId);
    setMapsPreloadedResults(preloadedResults || null);
    setMapsPanelOpen(true);
  };

  const handleImageModified = (nodeId: string, newImage: string, text: string) => {
    const message: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'agent',
      text: text,
      image: newImage,
      mimeType: 'image/png',
      timestamp: new Date()
    };
    handleUpdateNodeMessages(nodeId, prev => [...prev, message]);
    addNodeMessage(nodeId, message);
    
    // ⭐ FIX QA: Persist modified image to journal
    const instanceId = nodeId.replace('node-', '');
    const workflowId = getCurrentWorkflowId();
    if (instanceId && workflowId) {
      enqueueJournalEntry(workflowId, instanceId, 'chat', {
        role: 'agent',
        content: text,
        imageBase64: newImage,
        mimeType: 'image/png'
      });
    }
  };

  const handleToggleNodeMinimize = (nodeId: string) => {
    // ⭐ ARCHITECTURE FIX: Store minimize state in useRuntimeStore (transient UI state, not persisted)
    // This approach separates concerns: coordinates in Design Store, UI state in Runtime Store
    const { toggleNodeMinimized } = useRuntimeStore.getState();
    toggleNodeMinimized(nodeId);
    console.log('[App] Toggled minimize for node:', nodeId);
  };

  const handleUpdateNodeMessages = (nodeId: string, messages: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
    setWorkflowNodes(prev => prev.map(node =>
      node.id === nodeId
        ? { ...node, messages: typeof messages === 'function' ? messages(node.messages) : messages }
        : node
    ));
  };

  const handleOpenFullscreen = (src: string, mimeType: string) => {
    setFullscreenImage({ src, mimeType });
  };

  const handleOpenAgentFullscreen = (nodeId: string) => {
    // Utiliser le store runtime pour ouvrir le FullscreenChatModal existant
    const { setFullscreenChatNodeId } = useRuntimeStore.getState();
    setFullscreenChatNodeId(nodeId);
  };

  const handleAddToWorkflow = (agent: Agent) => {
    addAgentToWorkflow(agent);
  };

  return (
    <QueryProvider>
      <NotificationProvider>
        {/* ⭐ UX Polish: Hyperspace Entry Animation for Guests */}
        {showHyperspace && !isAuthenticated && (
          <HyperspaceReveal
            isActive={hyperspaceActive}
            onComplete={handleHyperspaceComplete}
            className="fixed inset-0 z-[100]"
          >
            {/* Empty children - the app will be revealed underneath */}
            <div className="w-full h-full" />
          </HyperspaceReveal>
        )}

        {/* ⭐ V2: Overlay dédié au switch workflow (jaune Bos) */}
        <WorkflowSwitchOverlay
          isLoading={isSwitchingWorkflow}
          workflowName={switchWorkflowName}
          progress={switchProgress}
        />

        {/* ⭐ ÉTAPE 5: Hydration Overlay - Blur Racing Style (login only) */}
        <HydrationOverlay 
          isLoading={isHydrating} 
          progress={hydrationProgress}
          message={hydrationMessage}
        />

        <div className="flex flex-col h-screen bg-gray-900 text-gray-100 font-sans">
          <Header
            onOpenSettings={() => setSettingsModalOpen(true)}
          />
          <div className="flex flex-1 overflow-hidden">
            <NavigationLayout
              agents={agents}
              isCollapsed={isSidebarCollapsed}
              onToggleCollapse={() => setSidebarCollapsed(!isSidebarCollapsed)}
              onAddAgent={() => { setEditingAgent(null); setAgentModalOpen(true); }}
              onAddToWorkflow={addAgentToWorkflow}
              onDeleteAgent={handleDeleteAgent}
              onEditAgent={handleOpenEditAgentModal}
              currentPath={currentPath}
              onNavigate={handleRobotNavigation}
            />
            <main className="flex-1 bg-gray-800/50 overflow-hidden">
              <RobotPageRouter
                currentPath={currentPath}
                llmConfigs={llmConfigs}
                onNavigate={handleRobotNavigation}
                agents={agents}
                workflowNodes={workflowNodes}
                onDeleteNode={handleDeleteNode}
                onDeleteNodes={handleDeleteNodes}
                onUpdateNodeMessages={handleUpdateNodeMessages}
                onUpdateNodePosition={handleUpdateNodePosition}
                onToggleNodeMinimize={handleToggleNodeMinimize}
                onToggleNodeMaximize={handleToggleNodeMaximize}
                onOpenImagePanel={handleOpenImagePanel}
                onOpenImageModificationPanel={handleOpenImageModificationPanel}
                onOpenVideoPanel={handleOpenVideoPanel}
                onOpenMapsPanel={handleOpenMapsPanel}
                onOpenFullscreen={handleOpenFullscreen}
                onOpenAgentFullscreen={handleOpenAgentFullscreen}
                onAddToWorkflow={handleAddToWorkflow}
                isImagePanelOpen={isImagePanelOpen}
                isImageModificationPanelOpen={isImageModificationPanelOpen}
                isVideoPanelOpen={isVideoPanelOpen}
                isMapsPanelOpen={isMapsPanelOpen}
              />
            </main>
          </div>

          {isSettingsModalOpen && (
            <SettingsModal
              llmConfigs={llmConfigs}
              onClose={() => setSettingsModalOpen(false)}
              onSave={handleSaveSettings}
            />
          )}

          {isLoginModalOpen && (
            <LoginModal
              isOpen={isLoginModalOpen}
              onClose={() => setLoginModalOpen(false)}
            />
          )}

          {isRegisterModalOpen && (
            <RegisterModal
              isOpen={isRegisterModalOpen}
              onClose={() => setRegisterModalOpen(false)}
            />
          )}

          {isAgentModalOpen && (
            <AgentFormModal
              onClose={() => { setAgentModalOpen(false); setEditingAgent(null); }}
              onSave={handleSaveAgent}
              llmConfigs={llmConfigs}
              existingAgent={editingAgent}
              localLLMProfiles={localLLMProfiles}
            />
          )}

          {updateConfirmation && (
            <ConfirmationModal
              isOpen={true}
              title={t('dialog_update_title')}
              message={t('dialog_update_message', { count: updateConfirmation.count })}
              confirmText={t('dialog_update_confirmButton')}
              cancelText={t('dialog_update_cancelButton')}
              onConfirm={() => handleUpdateConfirmation(true)}
              onCancel={() => handleUpdateConfirmation(false)}
            />
          )}

          {deleteConfirmation && (
            <ConfirmationModal
              isOpen={true}
              title={t('dialog_delete_title')}
              message={t('dialog_delete_message', { agentName: deleteConfirmation.agentName })}
              confirmText={t('dialog_delete_confirmButton')}
              onConfirm={confirmDeleteAgent}
              onCancel={() => setDeleteConfirmation(null)}
              variant="danger"
            />
          )}

          {isImagePanelOpen && (
            <>
              <ImageGenerationPanel
                isOpen={isImagePanelOpen}
                nodeId={currentImageNodeId}
                agent={currentImageAgent}
                agentInstance={currentImageAgentInstance}
                llmConfigs={llmConfigs}
                workflowNodes={workflowNodes}
                onClose={() => setImagePanelOpen(false)}
                onImageGenerated={handleImageGenerated}
                onOpenImageModificationPanel={handleOpenImageModificationPanel}
              />
            </>
          )}

          {isImageModificationPanelOpen && (
            <ImageModificationPanel
              isOpen={isImageModificationPanelOpen}
              editingImageInfo={editingImageInfo}
              llmConfigs={llmConfigs}
              workflowNodes={workflowNodes}
              onClose={() => setImageModificationPanelOpen(false)}
              onImageModified={handleImageModified}
            />
          )}

          {isVideoPanelOpen && (
            <VideoGenerationConfigPanel
              isOpen={isVideoPanelOpen}
              nodeId={currentVideoNodeId}
              llmConfigs={llmConfigs}
              workflowNodes={workflowNodes}
              onClose={() => setVideoPanelOpen(false)}
            />
          )}

          {isMapsPanelOpen && (
            <MapsGroundingConfigPanel
              isOpen={isMapsPanelOpen}
              nodeId={currentMapsNodeId}
              llmConfigs={llmConfigs}
              workflowNodes={workflowNodes}
              onClose={() => {
                setMapsPanelOpen(false);
                setMapsPreloadedResults(null);
              }}
              preloadedResults={mapsPreloadedResults || undefined}
            />
          )}

          {fullscreenImage && (
            <div
              className="fixed inset-0 z-[70] flex items-center justify-center bg-black bg-opacity-80 backdrop-blur-sm"
              onClick={() => setFullscreenImage(null)}
            >
              <img
                src={`data:${fullscreenImage.mimeType};base64,${fullscreenImage.src}`}
                alt={t('fullscreenModal_alt')}
                className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
                onClick={(e) => e.stopPropagation()}
              />
              <Button
                variant="ghost"
                onClick={() => setFullscreenImage(null)}
                className="absolute top-4 right-4 text-white text-2xl px-2 py-2"
                aria-label={t('fullscreenModal_close_aria')}
              >
                &times;
              </Button>
            </div>
          )}

          {/* Fullscreen Chat Modal */}
          <FullscreenChatModal
            onDeleteNode={handleDeleteNode}
            onOpenImagePanel={handleOpenImagePanel}
            onOpenVideoPanel={handleOpenVideoPanel}
            onOpenMapsPanel={handleOpenMapsPanel}
            onOpenFullscreen={handleOpenFullscreen}
            onOpenImageModificationPanel={handleOpenImageModificationPanel}
            onImageGenerated={handleImageGenerated}
          />

          {/* Configuration Modal */}
          <AgentConfigurationModal llmConfigs={llmConfigs} localLLMProfiles={localLLMProfiles} />

          <NotificationDisplay />
        </div>
      </NotificationProvider>
    </QueryProvider>
  );
}

/**
 * Root App component with all providers
 * AuthProvider wraps AppContent to enable useAuth() hook
 */
function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;

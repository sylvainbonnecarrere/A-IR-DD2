import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Agent, AgentBatchDeleteResult, AgentDeletionMediaPolicy, AgentDraft, LLMConfig, LLMProvider, WorkflowNode, LLMCapability, ChatMessage, HistoryConfig, RobotId, V2WorkflowNode, AgentInstance, NodePositionUpdateOptions, normalizePersistenceConfig } from './types';
import { NavigationLayout } from './components/NavigationLayout';
import { RobotPageRouter } from './components/RobotPageRouter';
import { AgentFormModal } from './components/modals/AgentFormModal';
import { SettingsModal } from './components/modals/SettingsModal';
import { Header } from './components/Header';
import { LoginModal } from './components/modals/LoginModal';
import { RegisterModal } from './components/modals/RegisterModal';
import { ImageGenerationPanel } from './components/panels/ImageGenerationPanel';
import { ImageModificationPanel } from './components/panels/ImageModificationPanel';
import { VideoGenerationConfigPanel } from './components/panels/VideoGenerationConfigPanel';
import { MapsGroundingConfigPanel } from './components/panels/MapsGroundingConfigPanel';
import { useLocalization } from './hooks/useLocalization';
import { Button } from './components/UI';
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
import { createAgentPrototype, updateAgentPrototype } from './services/agentPrototypeAPI';
import { resolveActiveWorkflowId } from './services/workflowIdResolver';
import { remapAgentInstanceReference, remapEditingImageInfo, remapPanelNodeId } from './utils/mediaPanelRuntimeSync';
// ⭐ V2: Import apiClient for workflow switch orchestration
import apiClient from './utils/apiClient';
// ⭐ FIX QA: Import useJournalQueue for image persistence
import { useJournalQueue } from './hooks/useJournalQueue';
import type { WorkspaceSnapshot } from './services/workspaceBootstrapService';
import { useWorkspaceHydrationOrchestrator } from './hooks/useWorkspaceHydrationOrchestrator';
import { findAvailableWorkflowNodePosition, findCollisionFreeWorkflowNodePosition } from './utils/workflowNodePlacement';

interface EditingImageInfo {
  nodeId: string;
  sourceImage: string;
  mimeType: string;
  agent?: Agent;
  agentInstance?: AgentInstance;
}

/**
 * Inner App component that uses Auth context
 * Must be wrapped by AuthProvider to access useAuth()
 */
export function AppContent() {
  const { isAuthenticated, accessToken, runtimeLLMConfigs: authRuntimeLLMConfigs, localLLMProfiles: authLocalLLMProfiles, user, logout, refreshRuntimeConfigState, sessionStatus, isLoading: authLoading, error: authError } = useAuth();
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

  const [editingImageInfo, setEditingImageInfo] = useState<EditingImageInfo | null>(null);
  const [mapsPreloadedResults, setMapsPreloadedResults] = useState<{
    text: string;
    mapSources: any[];
    query?: string;
  } | null>(null);
  const [isSidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState<{ src: string; mimeType: string } | null>(null);
  const { t } = useLocalization();

  // ⭐ V2: Flag to distinguish initial login hydration from user-initiated workflow switch
  // isInitialHydrationRef removed (was dead code — never read)

  // ⭐ V2: State dédié au switch overlay (séparé de l'hydratation login)
  const [isSwitchingWorkflow, setIsSwitchingWorkflow] = useState(false);
  const [switchProgress, setSwitchProgress] = useState(0);
  const [switchWorkflowName, setSwitchWorkflowName] = useState('');
  const isSwitchingRef = useRef(false);  // Guard anti-re-entrance (pas de useState pour éviter re-render)
  const [awaitingHydratedCanvasReady, setAwaitingHydratedCanvasReady] = useState(false);

  // Robot Navigation State
  const [currentPath, setCurrentPath] = useState('/bos/dashboard');
  const currentRouteUsesWorkflowCanvas = currentPath.startsWith('/bos/dashboard')
    || (currentPath.startsWith('/bos') && !currentPath.startsWith('/bos/workflows/manage'));

  const handleRobotNavigation = (robotId: RobotId, path: string) => {
    setCurrentPath(path);
    // TODO: Implement proper routing logic
    console.log(`Navigating to robot ${robotId} at path ${path}`);
  };

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
  const runtimeStoreLLMConfigs = useRuntimeStore((state) => state.llmConfigs);
  const runtimeStoreLocalLLMProfiles = useRuntimeStore((state) => state.localLLMProfiles);
  const runtimeNodeMessages = useRuntimeStore((state) => state.nodeMessages);
  const llmConfigs = runtimeStoreLLMConfigs.length > 0 ? runtimeStoreLLMConfigs : authRuntimeLLMConfigs;
  const localLLMProfiles = runtimeStoreLocalLLMProfiles.length > 0 ? runtimeStoreLocalLLMProfiles : authLocalLLMProfiles;

  // Design Store access for integrity validation  
  const {
    agents: designAgents,
    validateWorkflowIntegrity,
    cleanupOrphanedInstances,
    addAgentInstance,
    deleteNode,
    deleteAgentInstance,
    hydrateFromServer,
    updateInstanceId,
    updateAgentInstance,
    addNode,
    updateNode,
    agentInstances,
    nodes: storeNodes,
    workflows: designWorkflows,
    currentWorkflowId: designCurrentWorkflowId,
    currentRobotId,
  } = useDesignStore();

  // ⭐ SELF-HEALING: Workflow Store for hydrating workflow ID
  const { getCurrentWorkflowId } = useWorkflowStore();
  
  // ⭐ FIX QA: Journal queue for persisting generated images
  const { enqueueEntry: enqueueJournalEntry } = useJournalQueue();

  const resolveCurrentWorkflowId = useCallback(() => resolveActiveWorkflowId({
    designWorkflowId: designCurrentWorkflowId,
    designWorkflows,
    legacyWorkflowId: getCurrentWorkflowId(),
  }), [designCurrentWorkflowId, designWorkflows, getCurrentWorkflowId]);

  const {
    sessionReadyForWorkspaceHydration,
    awaitingStableAuthenticatedSession,
    isHydrating,
    hydrationProgress,
    hydrationMessage,
    hydrateInteractiveWorkspaceState,
  } = useWorkspaceHydrationOrchestrator({
    accessToken,
    authError,
    authLoading,
    isAuthenticated,
    isSwitchingRef,
    refreshRuntimeConfigState,
    sessionStatus,
    userId: user?.id ?? null,
  });

  const clearTransientUiState = useCallback(() => {
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
  * 4. Hydratation atomique → hydrateFromServer + hydrateWorkflowFromServer
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
      await hydrateInteractiveWorkspaceState(data.reloadedData, {
        preserveRuntimeMessages: false,
        onSnapshotApplied: () => setSwitchProgress(85),
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
  }, [accessToken, hydrateInteractiveWorkspaceState, t, isHydrating]);

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
    if (isAuthenticated && authRuntimeLLMConfigs.length === 0 && runtimeStoreLLMConfigs.length > 0) {
      return;
    }

    updateLLMConfigs(authRuntimeLLMConfigs);
  }, [authRuntimeLLMConfigs, isAuthenticated, runtimeStoreLLMConfigs.length, updateLLMConfigs]);

  // ⭐ NEW: Sync local LLM profiles into runtime store
  useEffect(() => {
    if (isAuthenticated && authLocalLLMProfiles.length === 0 && runtimeStoreLocalLLMProfiles.length > 0) {
      return;
    }

    updateLocalLLMProfiles(authLocalLLMProfiles);
  }, [authLocalLLMProfiles, isAuthenticated, runtimeStoreLocalLLMProfiles.length, updateLocalLLMProfiles]);

  useEffect(() => {
    if (isHydrating && currentRouteUsesWorkflowCanvas) {
      setAwaitingHydratedCanvasReady(true);
      return;
    }

    if (!currentRouteUsesWorkflowCanvas) {
      setAwaitingHydratedCanvasReady(false);
    }
  }, [currentRouteUsesWorkflowCanvas, isHydrating]);

  const handleWorkflowCanvasReady = useCallback(() => {
    setAwaitingHydratedCanvasReady(false);
  }, []);

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

    if (cleanedCount > 0 || fixedCount > 0) {
      console.log(`🚀 App startup integrity check completed: cleaned ${cleanedCount} instances, fixed ${fixedCount} nodes`);
    }
  }, []); // Run only once on mount

  const handleSaveAgent = async (agentData: AgentDraft, agentId?: string) => {
    try {
      if (!accessToken) {
        throw new Error('Missing access token for prototype persistence');
      }

      let backendId: string;
      const robotId = editingAgent?.creator_id ?? currentRobotId;

      if (agentId) {
        // ⭐ ÉTAPE 3: Update existing agent prototype
        console.log('[App] 📤 Updating agent prototype:', agentId);
        const apiResult = await updateAgentPrototype(agentId, agentData, accessToken, robotId);
        if (!apiResult.success || !apiResult.data) {
          throw new Error(apiResult.error || 'Prototype update failed');
        }

        backendId = apiResult.data.id || agentId;
        console.log('[App] ✅ Agent prototype updated:', backendId);
      } else {
        // ⭐ ÉTAPE 3: Create new agent prototype
        console.log('[App] 📤 Creating new agent prototype:', agentData.name);
        const apiResult = await createAgentPrototype(
          agentData,
          accessToken,
          robotId,
          resolveCurrentWorkflowId() || undefined,
        );
        if (!apiResult.success || !apiResult.data) {
          throw new Error(apiResult.error || 'Prototype creation failed');
        }

        backendId = apiResult.data.id;
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
        sessionStatus,
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
        isLoading: authLoading,
        error: authError
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
    // Use instanceName if provided, otherwise use agent name
    const instanceName = agent.instanceName || agent.name;

    // ⭐ Get workflowId BEFORE creating instance
    const workflowId = resolveCurrentWorkflowId();
    const designState = useDesignStore.getState();
    const position = findAvailableWorkflowNodePosition({
      workflowId,
      nodes: designState.nodes,
      agentInstances: designState.agentInstances,
    });

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
            persistenceConfig: normalizePersistenceConfig(
              result.instance.persistenceConfig || agent.persistenceConfig
            ),
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
            const fromNodeId = `node-${instanceId}`;
            const toNodeId = `node-${result.backendId}`;

            updateInstanceId(instanceId, result.backendId);
            useRuntimeStore.getState().renameNodeRuntimeState(fromNodeId, toNodeId);

            setCurrentImageNodeId((activeNodeId) => remapPanelNodeId(activeNodeId, fromNodeId, toNodeId));
            setCurrentImageAgentInstance((agentInstance) => remapAgentInstanceReference(agentInstance, instanceId, result.backendId, workflowId));
            setCurrentVideoNodeId((activeNodeId) => remapPanelNodeId(activeNodeId, fromNodeId, toNodeId));
            setCurrentVideoAgentInstance((agentInstance) => remapAgentInstanceReference(agentInstance, instanceId, result.backendId, workflowId));
            setCurrentMapsNodeId((activeNodeId) => remapPanelNodeId(activeNodeId, fromNodeId, toNodeId));
            setEditingImageInfo((imageInfo) => remapEditingImageInfo(imageInfo, fromNodeId, toNodeId, instanceId, result.backendId, workflowId));
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
      
    }
  }, [addAgentInstance, isAuthenticated, accessToken, resolveCurrentWorkflowId, updateInstanceId, addNode]);

  /**
   * ⭐ FIX: Suppression robuste d'un node avec persistance backend
   * Gère les deux formats d'ID (legacy et V2)
   */
  const handleDeleteNode = useCallback(async (nodeId: string) => {
    console.log('[App] handleDeleteNode called with:', nodeId);

    const v2Node = storeNodes.find((node) => node.id === nodeId);
    const finalInstanceId = v2Node?.data?.agentInstance?.id
      || (nodeId.startsWith('node-') ? nodeId.replace(/^node-/, '') : undefined);
    
    console.log('[App] Delete node resolution:', { 
      nodeId, 
      storeInstanceId: v2Node?.data?.agentInstance?.id,
      finalInstanceId 
    });

    // 4. Supprimer du store Zustand
    deleteNode(nodeId);

    // 5. Supprimer l'instance du store si trouvée
    if (finalInstanceId) {
      deleteAgentInstance(finalInstanceId);
      
      // 6. ⭐ CRITICAL: Persister la suppression au backend
      if (isAuthenticated) {
        const workflowId = resolveCurrentWorkflowId();
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
  }, [storeNodes, deleteNode, deleteAgentInstance, isAuthenticated, resolveCurrentWorkflowId]);

  const handleDeleteNodes = useCallback(async (instanceIds: string[], mediaPolicy: AgentDeletionMediaPolicy = 'delete_media'): Promise<AgentBatchDeleteResult> => {
    // Batch delete multiple nodes by instanceId (used when deleting prototype with instances)
    console.log('[App] handleDeleteNodes called with:', instanceIds, 'policy:', mediaPolicy);

    const failedInstanceIds: string[] = [];

    for (const instanceId of instanceIds) {
      let backendDeleted = true;

      if (isAuthenticated) {
        const workflowId = resolveCurrentWorkflowId();
        if (workflowId) {
          try {
            await apiClient.delete(`/api/workflows/${workflowId}/instances/${instanceId}`, {
              params: {
                mediaPolicy,
              },
            });
          } catch (error) {
            backendDeleted = false;
            failedInstanceIds.push(instanceId);
            console.error('[App] Error deleting instance:', instanceId, error);
          }
        }
      }

      if (!backendDeleted) {
        continue;
      }

      deleteNode(`node-${instanceId}`);
      deleteAgentInstance(instanceId);
    }

    return failedInstanceIds.length > 0
      ? {
          success: false,
          failedInstanceIds,
          error: `${failedInstanceIds.length} instance(s) n'ont pas pu etre supprimees avec la politique media demandee.`,
        }
      : { success: true };
  }, [deleteNode, deleteAgentInstance, isAuthenticated, accessToken, resolveCurrentWorkflowId]);

  const handleUpdateNodePosition = useCallback((nodeId: string, position: { x: number; y: number }, options?: NodePositionUpdateOptions) => {
    const designState = useDesignStore.getState();
    const movedNode = designState.nodes.find((node) => node.id === nodeId);
    const instanceId = movedNode?.data.agentInstance?.id;
    updateNode(nodeId, { position });

    if (instanceId) {
      updateAgentInstance(instanceId, { position });
    }

    if (!options?.persist || !instanceId) {
      return;
    }

    if (isAuthenticated && !accessToken) {
      console.warn('[App] Skipping node position persistence because the authenticated session has no access token yet:', {
        nodeId,
        instanceId,
      });
      return;
    }

    void PersistenceService.saveAgentInstance(
      {
        id: instanceId,
        position,
      },
      {
        isAuthenticated,
        accessToken: accessToken ?? undefined,
      },
    ).then((result) => {
      if (!result.success) {
        console.error('[App] Failed to persist node position after drag-stop:', {
          nodeId,
          instanceId,
          position,
          error: result.error,
        });
      }
    }).catch((error) => {
      console.error('[App] Unexpected error while persisting node position after drag-stop:', {
        nodeId,
        instanceId,
        position,
        error,
      });
    });
  }, [accessToken, isAuthenticated, updateAgentInstance, updateNode]);

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
    const workflowId = resolveCurrentWorkflowId();
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
    const workflowId = resolveCurrentWorkflowId();
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
    const runtimeStore = useRuntimeStore.getState();
    const previousMessages = runtimeStore.getNodeMessages(nodeId);
    runtimeStore.setNodeMessages(
      nodeId,
      typeof messages === 'function' ? messages(previousMessages) : messages,
    );
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
          isLoading={isHydrating || awaitingStableAuthenticatedSession || awaitingHydratedCanvasReady}
          progress={isHydrating ? hydrationProgress : awaitingHydratedCanvasReady ? 100 : 10}
          message={isHydrating ? hydrationMessage : awaitingHydratedCanvasReady ? 'Preparation de la carte...' : 'Stabilisation de la session...'}
        />

        <div className="flex flex-col h-screen bg-gray-900 text-gray-100 font-sans">
          <Header
            onOpenSettings={() => setSettingsModalOpen(true)}
          />
          <div className="flex flex-1 overflow-hidden">
            <NavigationLayout
              agents={designAgents}
              isCollapsed={isSidebarCollapsed}
              onToggleCollapse={() => setSidebarCollapsed(!isSidebarCollapsed)}
              onAddAgent={() => { setEditingAgent(null); setAgentModalOpen(true); }}
              onAddToWorkflow={addAgentToWorkflow}
              onEditAgent={handleOpenEditAgentModal}
              currentPath={currentPath}
              onNavigate={handleRobotNavigation}
            />
            <main className="flex-1 bg-gray-800/50 overflow-hidden">
              <RobotPageRouter
                currentPath={currentPath}
                llmConfigs={llmConfigs}
                onNavigate={handleRobotNavigation}
                onWorkflowCanvasReady={handleWorkflowCanvasReady}
                agents={designAgents}
                onDeleteNode={handleDeleteNode}
                onDeleteNodes={handleDeleteNodes}
                onUpdateNodeMessages={handleUpdateNodeMessages}
                onUpdateNodePosition={handleUpdateNodePosition}
                onToggleNodeMinimize={handleToggleNodeMinimize}
                onOpenImagePanel={handleOpenImagePanel}
                onOpenImageModificationPanel={handleOpenImageModificationPanel}
                onOpenVideoPanel={handleOpenVideoPanel}
                onOpenMapsPanel={handleOpenMapsPanel}
                onOpenFullscreen={handleOpenFullscreen}
                onAddToWorkflow={handleAddToWorkflow}
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

          {isImagePanelOpen && (
            <>
              <ImageGenerationPanel
                isOpen={isImagePanelOpen}
                nodeId={currentImageNodeId}
                agent={currentImageAgent}
                agentInstance={currentImageAgentInstance}
                llmConfigs={llmConfigs}
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
              onClose={() => setImageModificationPanelOpen(false)}
              onImageModified={handleImageModified}
            />
          )}

          {isVideoPanelOpen && (
            <VideoGenerationConfigPanel
              isOpen={isVideoPanelOpen}
              nodeId={currentVideoNodeId}
              llmConfigs={llmConfigs}
              onClose={() => setVideoPanelOpen(false)}
            />
          )}

          {isMapsPanelOpen && (
            <MapsGroundingConfigPanel
              isOpen={isMapsPanelOpen}
              nodeId={currentMapsNodeId}
              llmConfigs={llmConfigs}
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

import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef } from 'react';
import { Agent, AgentBatchDeleteResult, AgentDeletionMediaPolicy, LLMConfig, LLMProvider, WorkflowNode, LLMCapability, ChatMessage, HistoryConfig, RobotId, V2WorkflowNode, AgentInstance, NodePositionUpdateOptions, MapsPanelPreloadedResults, normalizePersistenceConfig } from './types';
import { NavigationLayout } from './components/NavigationLayout';
import { RobotPageRouter } from './components/RobotPageRouter';
import { Header } from './components/Header';
import { useLocalization } from './hooks/useLocalization';
import { Button } from './components/UI';
import { FullscreenChatModal } from './components/modals/FullscreenChatModal';
import { AgentConfigurationModal } from './components/modals/AgentConfigurationModal';
import { useRuntimeStore } from './stores/useRuntimeStore';
import { useDesignStore } from './stores/useDesignStore';
import { useFunctionStore } from './stores/useFunctionStore';
import { useAppShellStore } from './stores/useAppShellStore';
import { NotificationProvider } from './contexts';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { NotificationDisplay } from './components/NotificationDisplay';
import { QueryProvider } from './providers';
import { getSettingsStorage } from './utils/SettingsStorage';
import { webSocketService } from './services/webSocketService';
// ⭐ ÉTAPE 5: Import HydrationOverlay for loading state
import { HydrationOverlay } from './components/HydrationOverlay';
// ⭐ V2: Import WorkflowSwitchOverlay for workflow switch (Bos amber)
import { WorkflowSwitchOverlay } from './components/WorkflowSwitchOverlay';
// ⭐ AUTO-SAVE: Import PersistenceService for immediate instance creation
import { PersistenceService } from './services/persistenceService';
import { deleteWorkflowInstance, deleteWorkflowInstances, persistNodePosition } from './services/appWorkflowPersistenceService';
import { createAgentPrototype, updateAgentPrototype } from './services/agentPrototypeAPI';
import { resolveActiveWorkflowId } from './services/workflowIdResolver';
import { remapAgentInstanceReference, remapEditingImageInfo, remapPanelNodeId } from './utils/mediaPanelRuntimeSync';
// ⭐ V2: Import apiClient for workflow switch orchestration
import apiClient from './utils/apiClient';
// ⭐ FIX QA: Import useJournalQueue for image persistence
import { useJournalQueue } from './hooks/useJournalQueue';
import type { WorkspaceSnapshot } from './services/workspaceBootstrapService';
import { useAppWorkflowController } from './hooks/useAppWorkflowController';
import { findAvailableWorkflowNodePosition, findCollisionFreeWorkflowNodePosition } from './utils/workflowNodePlacement';
import { generateRuntimeMessageId } from './utils/runtimeMessageId';
import { ROBOT_PAGE_ROUTE_IDS, resolveRobotPageRoute } from './utils/robotPageRouting';

const LazySettingsModal = lazy(async () => {
  const module = await import('./components/modals/SettingsModal');
  return { default: module.SettingsModal };
});
const LazyLoginModal = lazy(async () => {
  const module = await import('./components/modals/LoginModal');
  return { default: module.LoginModal };
});
const LazyRegisterModal = lazy(async () => {
  const module = await import('./components/modals/RegisterModal');
  return { default: module.RegisterModal };
});
const LazyImageGenerationPanel = lazy(async () => {
  const module = await import('./components/panels/ImageGenerationPanel');
  return { default: module.ImageGenerationPanel };
});
const LazyImageModificationPanel = lazy(async () => {
  const module = await import('./components/panels/ImageModificationPanel');
  return { default: module.ImageModificationPanel };
});
const LazyVideoGenerationConfigPanel = lazy(async () => {
  const module = await import('./components/panels/VideoGenerationConfigPanel');
  return { default: module.VideoGenerationConfigPanel };
});
const LazyMapsGroundingConfigPanel = lazy(async () => {
  const module = await import('./components/panels/MapsGroundingConfigPanel');
  return { default: module.MapsGroundingConfigPanel };
});
const LazyHyperspaceReveal = lazy(async () => {
  const module = await import('./components/HyperspaceReveal');
  return { default: module.HyperspaceReveal };
});

const DeferredUiFallback: React.FC = () => null;

function isRobotId(robotId: string): robotId is RobotId {
  return Object.values(RobotId).includes(robotId as RobotId);
}

/**
 * Inner App component that uses Auth context
 * Must be wrapped by AuthProvider to access useAuth()
 */
export function AppContent() {
  const { isAuthenticated, accessToken, runtimeLLMConfigs: authRuntimeLLMConfigs, localLLMProfiles: authLocalLLMProfiles, user, logout, refreshRuntimeConfigState, sessionStatus, isLoading: authLoading, error: authError } = useAuth();
  const isSettingsModalOpen = useAppShellStore((state) => state.isSettingsModalOpen);
  const isLoginModalOpen = useAppShellStore((state) => state.isLoginModalOpen);
  const isRegisterModalOpen = useAppShellStore((state) => state.isRegisterModalOpen);
  const isImagePanelOpen = useAppShellStore((state) => state.isImagePanelOpen);
  const isImageModificationPanelOpen = useAppShellStore((state) => state.isImageModificationPanelOpen);
  const isVideoPanelOpen = useAppShellStore((state) => state.isVideoPanelOpen);
  const isMapsPanelOpen = useAppShellStore((state) => state.isMapsPanelOpen);
  const currentImageNodeId = useAppShellStore((state) => state.currentImageNodeId);
  const currentImageAgent = useAppShellStore((state) => state.currentImageAgent);
  const currentImageAgentInstance = useAppShellStore((state) => state.currentImageAgentInstance);
  const currentVideoNodeId = useAppShellStore((state) => state.currentVideoNodeId);
  const currentVideoAgent = useAppShellStore((state) => state.currentVideoAgent);
  const currentVideoAgentInstance = useAppShellStore((state) => state.currentVideoAgentInstance);
  const currentMapsNodeId = useAppShellStore((state) => state.currentMapsNodeId);
  const editingImageInfo = useAppShellStore((state) => state.editingImageInfo);
  const mapsPreloadedResults = useAppShellStore((state) => state.mapsPreloadedResults);
  const fullscreenImage = useAppShellStore((state) => state.fullscreenImage);
  const currentPath = useAppShellStore((state) => state.currentPath);
  const showHyperspace = useAppShellStore((state) => state.showHyperspace);
  const hyperspaceActive = useAppShellStore((state) => state.hyperspaceActive);
  const setSettingsModalOpen = useAppShellStore((state) => state.setSettingsModalOpen);
  const setLoginModalOpen = useAppShellStore((state) => state.setLoginModalOpen);
  const setRegisterModalOpen = useAppShellStore((state) => state.setRegisterModalOpen);
  const setImagePanelOpen = useAppShellStore((state) => state.setImagePanelOpen);
  const setImageModificationPanelOpen = useAppShellStore((state) => state.setImageModificationPanelOpen);
  const setVideoPanelOpen = useAppShellStore((state) => state.setVideoPanelOpen);
  const setMapsPanelOpen = useAppShellStore((state) => state.setMapsPanelOpen);
  const setCurrentImageNodeId = useAppShellStore((state) => state.setCurrentImageNodeId);
  const setCurrentImageAgent = useAppShellStore((state) => state.setCurrentImageAgent);
  const setCurrentImageAgentInstance = useAppShellStore((state) => state.setCurrentImageAgentInstance);
  const setCurrentVideoNodeId = useAppShellStore((state) => state.setCurrentVideoNodeId);
  const setCurrentVideoAgent = useAppShellStore((state) => state.setCurrentVideoAgent);
  const setCurrentVideoAgentInstance = useAppShellStore((state) => state.setCurrentVideoAgentInstance);
  const setCurrentMapsNodeId = useAppShellStore((state) => state.setCurrentMapsNodeId);
  const setEditingImageInfo = useAppShellStore((state) => state.setEditingImageInfo);
  const setMapsPreloadedResults = useAppShellStore((state) => state.setMapsPreloadedResults);
  const setFullscreenImage = useAppShellStore((state) => state.setFullscreenImage);
  const setCurrentPath = useAppShellStore((state) => state.setCurrentPath);
  const setShowHyperspace = useAppShellStore((state) => state.setShowHyperspace);
  const setHyperspaceActive = useAppShellStore((state) => state.setHyperspaceActive);
  const { t } = useLocalization();

  // ⭐ V2: Flag to distinguish initial login hydration from user-initiated workflow switch
  // isInitialHydrationRef removed (was dead code — never read)

  // Robot Navigation State
  const currentResolvedRoute = useMemo(() => resolveRobotPageRoute(currentPath), [currentPath]);
  const currentRouteUsesWorkflowCanvas = currentResolvedRoute === ROBOT_PAGE_ROUTE_IDS.bosDashboard
    || currentResolvedRoute === ROBOT_PAGE_ROUTE_IDS.bosSupervision;

  const handleRobotNavigation = useCallback((robotId: RobotId, path: string) => {
    setCurrentPath(path);
    // TODO: Implement proper routing logic
    console.log(`Navigating to robot ${robotId} at path ${path}`);
  }, []);

  const handleRuntimeNavigation = useCallback((robotId: string, path: string) => {
    if (!isRobotId(robotId)) {
      console.warn('[App] Ignoring navigation request with unknown robotId:', robotId);
      return;
    }

    handleRobotNavigation(robotId, path);
  }, [handleRobotNavigation]);

  // Shows only after an authenticated session drops back to guest mode.
  // Avoid mounting the heavy entry animation on cold guest boot because it can
  // monopolize the main thread before the canvas becomes interactive.
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
  const updateLLMConfigs = useRuntimeStore((state) => state.updateLLMConfigs);
  const updateLocalLLMProfiles = useRuntimeStore((state) => state.updateLocalLLMProfiles);
  const setNavigationHandler = useRuntimeStore((state) => state.setNavigationHandler);
  const addNodeMessage = useRuntimeStore((state) => state.addNodeMessage);
  const setRuntimeConnectionState = useRuntimeStore((state) => state.setRuntimeConnectionState);
  const recordRuntimeEvent = useRuntimeStore((state) => state.recordRuntimeEvent);
  const runtimeStoreLLMConfigs = useRuntimeStore((state) => state.llmConfigs);
  const runtimeStoreLocalLLMProfiles = useRuntimeStore((state) => state.localLLMProfiles);
  const runtimeNodeMessages = useRuntimeStore((state) => state.nodeMessages);
  const llmConfigs = runtimeStoreLLMConfigs.length > 0 ? runtimeStoreLLMConfigs : authRuntimeLLMConfigs;
  const localLLMProfiles = runtimeStoreLocalLLMProfiles.length > 0 ? runtimeStoreLocalLLMProfiles : authLocalLLMProfiles;

  useEffect(() => {
    const handleConnectionStateChange = (state: { isConnected: boolean; isConnecting: boolean; error: string | null }) => {
      if (state.isConnected) {
        setRuntimeConnectionState('connected');
        return;
      }
      if (state.isConnecting) {
        setRuntimeConnectionState('reconnecting');
        return;
      }
      setRuntimeConnectionState(state.error ? 'degraded' : 'offline');
    };

    const handleRuntimeEvent = (event: { id: string; type: string; version: number; aggregateType: 'run' | 'task'; aggregateId: string; workspaceId: string; correlationId?: string; occurredAt: string; payload: Record<string, unknown> }) => {
      recordRuntimeEvent(event);
    };

    webSocketService.on('connectionStateChanged', handleConnectionStateChange);
    webSocketService.on('runtimeEvent', handleRuntimeEvent);

    return () => {
      webSocketService.off('connectionStateChanged', handleConnectionStateChange);
      webSocketService.off('runtimeEvent', handleRuntimeEvent);
    };
  }, [recordRuntimeEvent, setRuntimeConnectionState]);

  // Design Store access for integrity validation  
  const designAgents = useDesignStore((state) => state.agents);
  const validateWorkflowIntegrity = useDesignStore((state) => state.validateWorkflowIntegrity);
  const cleanupOrphanedInstances = useDesignStore((state) => state.cleanupOrphanedInstances);
  const addAgentInstance = useDesignStore((state) => state.addAgentInstance);
  const deleteNode = useDesignStore((state) => state.deleteNode);
  const deleteAgentInstance = useDesignStore((state) => state.deleteAgentInstance);
  const hydrateFromServer = useDesignStore((state) => state.hydrateFromServer);
  const updateInstanceId = useDesignStore((state) => state.updateInstanceId);
  const updateAgentInstance = useDesignStore((state) => state.updateAgentInstance);
  const addNode = useDesignStore((state) => state.addNode);
  const updateNode = useDesignStore((state) => state.updateNode);
  const agentInstances = useDesignStore((state) => state.agentInstances);
  const storeNodes = useDesignStore((state) => state.nodes);
  const designWorkflows = useDesignStore((state) => state.workflows);
  const designCurrentWorkflowId = useDesignStore((state) => state.currentWorkflowId);

  // ⭐ V2: The design store is the canonical workflow identity source.
  // Legacy workflow-store fallback is intentionally removed from the active workflow resolver.

  // ⭐ FIX QA: Journal queue for persisting generated images
  const { enqueueEntry: enqueueJournalEntry } = useJournalQueue();

  const resolveCurrentWorkflowId = useCallback(() => resolveActiveWorkflowId({
    designWorkflowId: designCurrentWorkflowId,
    designWorkflows,
  }), [designCurrentWorkflowId, designWorkflows]);

  const {
    switchToWorkflow,
    handleWorkflowCanvasReady,
    isSwitchingWorkflow,
    switchProgress,
    switchWorkflowName,
    shouldShowHydrationOverlay,
    hydrationOverlayProgress,
    hydrationOverlayMessage,
  } = useAppWorkflowController({
    accessToken,
    authError,
    authLoading,
    isAuthenticated,
    refreshRuntimeConfigState,
    sessionStatus,
    userId: user?.id ?? null,
    currentRouteUsesWorkflowCanvas,
    t,
  });

  const clearTransientUiState = useCallback(() => {
    useAppShellStore.getState().clearTransientUiState();
  }, []);

  const resetGuestShellState = useCallback(() => {
    useAppShellStore.getState().resetGuestShellState();
  }, []);



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

    if (!isAuthenticated) {
      resetGuestShellState();
      return;
    }

    clearTransientUiState();
  }, [clearTransientUiState, isAuthenticated, resetGuestShellState, user?.id]);

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

  // ⭐ V2: L'ancien watcher PHASE 2 (resetAll sur currentWorkflowId change) est supprimé.
  // switchToWorkflow() orchestre désormais le reset + rechargement complet.
  // Garder le watcher causerait un double reset du runtimeStore.

  // Configure navigation handler for agent nodes
  useEffect(() => {
    setNavigationHandler(handleRuntimeNavigation);
  }, [handleRuntimeNavigation, setNavigationHandler]);

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
        const backendId = result.backendId;
        if (backendId && result.instance) {
          const persistedBackendId: string = backendId;
          
          // ✅ Remplacer l'instance temporaire par l'instance backend complète
          // Incluant la configuration_json qui sera utilisée dans AgentConfigurationModal
          const backendInstance: AgentInstance = {
            id: persistedBackendId,
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
          if (persistedBackendId !== instanceId) {
            const fromNodeId = `node-${instanceId}`;
            const toNodeId = `node-${persistedBackendId}`;

            updateInstanceId(instanceId, persistedBackendId);
            useRuntimeStore.getState().renameNodeRuntimeState(fromNodeId, toNodeId);

            setCurrentImageNodeId((activeNodeId) => remapPanelNodeId(activeNodeId, fromNodeId, toNodeId));
            setCurrentImageAgentInstance((agentInstance) => remapAgentInstanceReference(agentInstance, instanceId, persistedBackendId, workflowId));
            setCurrentVideoNodeId((activeNodeId) => remapPanelNodeId(activeNodeId, fromNodeId, toNodeId));
            setCurrentVideoAgentInstance((agentInstance) => remapAgentInstanceReference(agentInstance, instanceId, persistedBackendId, workflowId));
            setCurrentMapsNodeId((activeNodeId) => remapPanelNodeId(activeNodeId, fromNodeId, toNodeId));
            setEditingImageInfo((imageInfo) => remapEditingImageInfo(imageInfo, fromNodeId, toNodeId, instanceId, persistedBackendId, workflowId));
          }
          // ✅ Ensuite mettre à jour la configuration complète
          // Use getState() for stable reference (avoid dependency on updateAgentInstance)
          useDesignStore.getState().updateAgentInstance(persistedBackendId, backendInstance);
          finalInstanceId = persistedBackendId;
        } else if (!backendId) {
          console.error('[App] ❌ Persisted agent instance is missing backendId:', result.instance);
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
      finalInstanceId,
    });

    deleteNode(nodeId);

    if (finalInstanceId) {
      deleteAgentInstance(finalInstanceId);
      const workflowId = resolveCurrentWorkflowId();
      const deleted = await deleteWorkflowInstance({
        workflowId,
        instanceId: finalInstanceId,
        isAuthenticated,
        accessToken,
      });

      if (deleted) {
        console.log('[App] ✅ Agent instance deleted from backend:', finalInstanceId);
      }
    }
  }, [storeNodes, deleteNode, deleteAgentInstance, isAuthenticated, accessToken, resolveCurrentWorkflowId]);

  const handleDeleteNodes = useCallback(async (instanceIds: string[], mediaPolicy: AgentDeletionMediaPolicy = 'delete_media'): Promise<AgentBatchDeleteResult> => {
    console.log('[App] handleDeleteNodes called with:', instanceIds, 'policy:', mediaPolicy);

    const workflowId = resolveCurrentWorkflowId();
    return deleteWorkflowInstances({
      workflowId,
      instanceIds,
      mediaPolicy,
      isAuthenticated,
      accessToken,
      onDeleteLocalNode: (nodeId) => deleteNode(nodeId),
      onDeleteLocalInstance: (instanceId) => deleteAgentInstance(instanceId),
    });
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

    void persistNodePosition({
      nodeId,
      position,
      instanceId,
      isAuthenticated,
      accessToken,
      updateNode,
      updateAgentInstance,
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
      id: generateRuntimeMessageId('image'),
      sender: 'agent',
      text: t('app_generatedImageText'),
      image: imageBase64,
      mimeType: 'image/png',
      timestamp: new Date()
    };
    addNodeMessage(nodeId, imageMessage);
    
    // ⭐ FIX QA: Persist generated image to journal
    const instanceId = nodeId.replace('node-', '');
    const workflowId = resolveCurrentWorkflowId();
    if (instanceId && workflowId) {
      enqueueJournalEntry(workflowId, instanceId, 'chat', {
        messageId: imageMessage.id,
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

  const handleOpenMapsPanel = (nodeId: string, preloadedResults?: MapsPanelPreloadedResults) => {
    setCurrentMapsNodeId(nodeId);
    setMapsPreloadedResults(preloadedResults || null);
    setMapsPanelOpen(true);
  };

  const handleImageModified = (nodeId: string, newImage: string, text: string) => {
    const message: ChatMessage = {
      id: generateRuntimeMessageId('image-modified'),
      sender: 'agent',
      text: text,
      image: newImage,
      mimeType: 'image/png',
      timestamp: new Date()
    };
    addNodeMessage(nodeId, message);
    
    // ⭐ FIX QA: Persist modified image to journal
    const instanceId = nodeId.replace('node-', '');
    const workflowId = resolveCurrentWorkflowId();
    if (instanceId && workflowId) {
      enqueueJournalEntry(workflowId, instanceId, 'chat', {
        messageId: message.id,
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
          <Suspense fallback={<DeferredUiFallback />}>
            <LazyHyperspaceReveal
              isActive={hyperspaceActive}
              onComplete={handleHyperspaceComplete}
              className="fixed inset-0 z-[100]"
            >
              <div className="w-full h-full" />
            </LazyHyperspaceReveal>
          </Suspense>
        )}

        {/* ⭐ V2: Overlay dédié au switch workflow (jaune Bos) */}
        <WorkflowSwitchOverlay
          isLoading={isSwitchingWorkflow}
          workflowName={switchWorkflowName}
          progress={switchProgress}
        />

        {/* ⭐ ÉTAPE 5: Hydration Overlay - transitions lourdes uniquement */}
        <HydrationOverlay 
          isLoading={shouldShowHydrationOverlay}
          progress={hydrationOverlayProgress}
          message={hydrationOverlayMessage}
        />

        <div className="flex flex-col h-screen bg-gray-900 text-gray-100 font-sans">
          <Header
            onOpenSettings={() => setSettingsModalOpen(true)}
          />
          <div className="flex flex-1 overflow-hidden">
            <NavigationLayout
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
            <Suspense fallback={<DeferredUiFallback />}>
              <LazySettingsModal
                llmConfigs={llmConfigs}
                onClose={() => setSettingsModalOpen(false)}
                onSave={handleSaveSettings}
              />
            </Suspense>
          )}

          {isLoginModalOpen && (
            <Suspense fallback={<DeferredUiFallback />}>
              <LazyLoginModal
                isOpen={isLoginModalOpen}
                onClose={() => setLoginModalOpen(false)}
              />
            </Suspense>
          )}

          {isRegisterModalOpen && (
            <Suspense fallback={<DeferredUiFallback />}>
              <LazyRegisterModal
                isOpen={isRegisterModalOpen}
                onClose={() => setRegisterModalOpen(false)}
              />
            </Suspense>
          )}

          {isImagePanelOpen && (
            <Suspense fallback={<DeferredUiFallback />}>
              <LazyImageGenerationPanel
                isOpen={isImagePanelOpen}
                nodeId={currentImageNodeId}
                agent={currentImageAgent}
                agentInstance={currentImageAgentInstance}
                llmConfigs={llmConfigs}
                onClose={() => setImagePanelOpen(false)}
                onImageGenerated={handleImageGenerated}
                onOpenImageModificationPanel={handleOpenImageModificationPanel}
              />
            </Suspense>
          )}

          {isImageModificationPanelOpen && (
            <Suspense fallback={<DeferredUiFallback />}>
              <LazyImageModificationPanel
                isOpen={isImageModificationPanelOpen}
                editingImageInfo={editingImageInfo}
                llmConfigs={llmConfigs}
                onClose={() => setImageModificationPanelOpen(false)}
                onImageModified={handleImageModified}
              />
            </Suspense>
          )}

          {isVideoPanelOpen && (
            <Suspense fallback={<DeferredUiFallback />}>
              <LazyVideoGenerationConfigPanel
                isOpen={isVideoPanelOpen}
                onClose={() => setVideoPanelOpen(false)}
              />
            </Suspense>
          )}

          {isMapsPanelOpen && (
            <Suspense fallback={<DeferredUiFallback />}>
              <LazyMapsGroundingConfigPanel
                isOpen={isMapsPanelOpen}
                nodeId={currentMapsNodeId}
                llmConfigs={llmConfigs}
                onClose={() => {
                  setMapsPanelOpen(false);
                  setMapsPreloadedResults(null);
                }}
                preloadedResults={mapsPreloadedResults || undefined}
              />
            </Suspense>
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

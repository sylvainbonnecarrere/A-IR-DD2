import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef } from 'react';
import { Agent, LLMConfig, RobotId } from './types';
import { NavigationLayout } from './components/NavigationLayout';
import { RobotPageRouter } from './components/RobotPageRouter';
import { Header } from './components/Header';
import { useLocalization } from './hooks/useLocalization';
import { Button } from './components/UI';
import { FullscreenChatModal } from './components/modals/FullscreenChatModal';
import { AgentConfigurationModal } from './components/modals/AgentConfigurationModal';
import { useRuntimeStore } from './stores/useRuntimeStore';
import { useDesignStore } from './stores/useDesignStore';

import { useAppShellStore } from './stores/useAppShellStore';
import { NotificationProvider } from './contexts';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { NotificationDisplay } from './components/NotificationDisplay';
import { QueryProvider } from './providers';
import { getSettingsStorage } from './utils/SettingsStorage';
import { webSocketService } from './services/webSocketService';
import type { RuntimeEventEnvelope } from './types/runtimeEvent.generated';
// ⭐ ÉTAPE 5: Import HydrationOverlay for loading state
import { HydrationOverlay } from './components/HydrationOverlay';
// ⭐ V2: Import WorkflowSwitchOverlay for workflow switch (Bos amber)
import { WorkflowSwitchOverlay } from './components/WorkflowSwitchOverlay';

import { resolveActiveWorkflowId } from './services/workflowIdResolver';
// ⭐ V2: Import apiClient for workflow switch orchestration

import { useAppWorkflowController } from './hooks/useAppWorkflowController';
import { useNodePersistenceActions } from './hooks/useNodePersistenceActions';
import { useAgentInstanceCreation } from './hooks/useAgentInstanceCreation';
import { useMediaPanelActions } from './hooks/useMediaPanelActions';
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
  const {
    isAuthenticated,
    accessToken,
    runtimeLLMConfigs: authRuntimeLLMConfigs,
    localLLMProfiles: authLocalLLMProfiles,
    user,
    logout,
    refreshRuntimeConfigState,
    sessionStatus,
    isLoading: authLoading,
    error: authError,
  } = useAuth();
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
  const _currentVideoNodeId = useAppShellStore((state) => state.currentVideoNodeId);
  const _currentVideoAgent = useAppShellStore((state) => state.currentVideoAgent);
  const _currentVideoAgentInstance = useAppShellStore((state) => state.currentVideoAgentInstance);
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
  const currentRouteUsesWorkflowCanvas =
    currentResolvedRoute === ROBOT_PAGE_ROUTE_IDS.bosDashboard || currentResolvedRoute === ROBOT_PAGE_ROUTE_IDS.bosSupervision;

  const handleRobotNavigation = useCallback(
    (robotId: RobotId, path: string) => {
      setCurrentPath(path);
      // TODO: Implement proper routing logic
      console.debug(`Navigating to robot ${robotId} at path ${path}`);
    },
    [setCurrentPath],
  );

  const handleRuntimeNavigation = useCallback(
    (robotId: string, path: string) => {
      if (!isRobotId(robotId)) {
        console.warn('[App] Ignoring navigation request with unknown robotId:', robotId);
        return;
      }

      handleRobotNavigation(robotId, path);
    },
    [handleRobotNavigation],
  );

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
  }, [isAuthenticated, setHyperspaceActive, setShowHyperspace]);

  // ⭐ UX: Auto-trigger warp after short delay when hyperspace is shown
  useEffect(() => {
    if (showHyperspace && !hyperspaceActive) {
      const timer = setTimeout(() => {
        setHyperspaceActive(true);
      }, 1500); // 1.5s idle phase before warp
      return () => clearTimeout(timer);
    }
  }, [showHyperspace, hyperspaceActive, setHyperspaceActive]);

  // ⭐ UX: Handle hyperspace animation complete
  const handleHyperspaceComplete = useCallback(() => {
    // Small delay to ensure smooth transition
    setTimeout(() => {
      setShowHyperspace(false);
      setHyperspaceActive(false);
    }, 100);
  }, [setHyperspaceActive, setShowHyperspace]);

  // Runtime Store access
  const updateLLMConfigs = useRuntimeStore((state) => state.updateLLMConfigs);
  const updateLocalLLMProfiles = useRuntimeStore((state) => state.updateLocalLLMProfiles);
  const setNavigationHandler = useRuntimeStore((state) => state.setNavigationHandler);
  const setRuntimeConnectionState = useRuntimeStore((state) => state.setRuntimeConnectionState);
  const recordRuntimeEvent = useRuntimeStore((state) => state.recordRuntimeEvent);
  const runtimeStoreLLMConfigs = useRuntimeStore((state) => state.llmConfigs);
  const runtimeStoreLocalLLMProfiles = useRuntimeStore((state) => state.localLLMProfiles);
  const _runtimeNodeMessages = useRuntimeStore((state) => state.nodeMessages);
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

    // ⭐ hygiène : type nommé partagé (version: 1 littéral) au lieu d'un type inline divergent
    const handleRuntimeEvent = (event: RuntimeEventEnvelope) => {
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
  const _hydrateFromServer = useDesignStore((state) => state.hydrateFromServer);
  const _agentInstances = useDesignStore((state) => state.agentInstances);
  const designWorkflows = useDesignStore((state) => state.workflows);
  const designCurrentWorkflowId = useDesignStore((state) => state.currentWorkflowId);

  // ⭐ V2: The design store is the canonical workflow identity source.
  // Legacy workflow-store fallback is intentionally removed from the active workflow resolver.

  const resolveCurrentWorkflowId = useCallback(
    () =>
      resolveActiveWorkflowId({
        designWorkflowId: designCurrentWorkflowId,
        designWorkflows,
      }),
    [designCurrentWorkflowId, designWorkflows],
  );

  const {
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
      console.debug(`🚀 App startup integrity check completed: cleaned ${cleanedCount} instances, fixed ${fixedCount} nodes`);
    }
  }, [cleanupOrphanedInstances, validateWorkflowIntegrity]); // Run only once on mount (setters stables)

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
        login: async () => {},
        register: async () => {},
        logout,
        refreshAccessToken: async () => {},
        clearError: () => {},
        refreshLLMApiKeys: async () => {},
        llmApiKeys: null,
        refreshRuntimeConfigState,
        isLoading: authLoading,
        error: authError,
      });

      // NOTE J4.4: LLMConfigs are now managed separately via useLLMConfigs hook
      // We only save PREFERENCES here (language, theme)
      // LLMConfigs should be saved via LLMConfigModal -> useLLMConfigs -> updateConfig()

      // Save preferences only
      await storage.saveSettings({
        preferences: { language: 'fr' },
      });

      await refreshRuntimeConfigState();
    } catch (error) {
      console.error('[App] handleSaveSettings error:', error);
    }
  };

  // ⭐ US-RC-11 (vague 3) : création d’instance agent extraite dans un hook dédié (remap cross-store dans mediaPanelSyncService)
  const { addAgentToWorkflow } = useAgentInstanceCreation({
    isAuthenticated,
    accessToken,
    resolveCurrentWorkflowId,
  });

  // ⭐ US-RC-11 (vague 1) : actions de persistance des nœuds extraites dans un hook dédié (signatures inchangées)
  const { handleDeleteNode, handleDeleteNodes, handleUpdateNodePosition } = useNodePersistenceActions({
    isAuthenticated,
    accessToken,
    resolveCurrentWorkflowId,
  });

  // ⭐ US-RC-11 (vague 2) : handlers des panneaux média extraits dans un hook dédié (signatures inchangées)
  const {
    handleOpenImagePanel,
    handleImageGenerated,
    handleOpenImageModificationPanel,
    handleOpenVideoPanel,
    handleOpenMapsPanel,
    handleImageModified,
    handleToggleNodeMinimize,
    handleUpdateNodeMessages,
    handleOpenFullscreen,
  } = useMediaPanelActions({ resolveCurrentWorkflowId });

  const handleAddToWorkflow = (agent: Agent) => {
    addAgentToWorkflow(agent);
  };

  return (
    <QueryProvider>
      <NotificationProvider>
        {/* ⭐ UX Polish: Hyperspace Entry Animation for Guests */}
        {showHyperspace && !isAuthenticated && (
          <Suspense fallback={<DeferredUiFallback />}>
            <LazyHyperspaceReveal isActive={hyperspaceActive} onComplete={handleHyperspaceComplete} className="fixed inset-0 z-[100]">
              <div className="w-full h-full" />
            </LazyHyperspaceReveal>
          </Suspense>
        )}

        {/* ⭐ V2: Overlay dédié au switch workflow (jaune Bos) */}
        <WorkflowSwitchOverlay isLoading={isSwitchingWorkflow} workflowName={switchWorkflowName} progress={switchProgress} />

        {/* ⭐ ÉTAPE 5: Hydration Overlay - transitions lourdes uniquement */}
        <HydrationOverlay isLoading={shouldShowHydrationOverlay} progress={hydrationOverlayProgress} message={hydrationOverlayMessage} />

        <div className="flex flex-col h-screen bg-gray-900 text-gray-100 font-sans">
          <Header onOpenSettings={() => setSettingsModalOpen(true)} />
          <div className="flex flex-1 overflow-hidden">
            <NavigationLayout currentPath={currentPath} onNavigate={handleRobotNavigation} />
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
              <LazySettingsModal llmConfigs={llmConfigs} onClose={() => setSettingsModalOpen(false)} onSave={handleSaveSettings} />
            </Suspense>
          )}

          {isLoginModalOpen && (
            <Suspense fallback={<DeferredUiFallback />}>
              <LazyLoginModal isOpen={isLoginModalOpen} onClose={() => setLoginModalOpen(false)} />
            </Suspense>
          )}

          {isRegisterModalOpen && (
            <Suspense fallback={<DeferredUiFallback />}>
              <LazyRegisterModal isOpen={isRegisterModalOpen} onClose={() => setRegisterModalOpen(false)} />
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
              <LazyVideoGenerationConfigPanel isOpen={isVideoPanelOpen} onClose={() => setVideoPanelOpen(false)} />
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

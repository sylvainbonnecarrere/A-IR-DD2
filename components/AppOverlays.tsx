import React, { Suspense, lazy } from 'react';
import { useAppShellStore } from '../stores/useAppShellStore';
import { useLocalization } from '../hooks/useLocalization';
import { Button } from './UI';
import { FullscreenChatModal } from './modals/FullscreenChatModal';
import { AgentConfigurationModal } from './modals/AgentConfigurationModal';
import { NotificationDisplay } from './NotificationDisplay';
import type { Agent, AgentInstance, LLMConfig, LocalLLMProfile, MapsPanelPreloadedResults } from '../types';

/**
 * US-RC-11 (vague 4) — composant `AppOverlays` : le JSX des 8 modales/panels lazy
 * + fullscreen image + FullscreenChatModal + AgentConfigurationModal + NotificationDisplay,
 * déplacé tel quel hors d'`App.tsx` (props identiques, rendu inchangé).
 *
 * L'état des overlays (open states, données des panneaux, setters de fermeture) est lu
 * directement depuis `useAppShellStore` (règle 4 : réutiliser les stores existants, pas
 * de nouveau store global ni de prop drilling) ; seuls les handlers et les configs LLM
 * viennent des props.
 */

const LazySettingsModal = lazy(async () => {
  const module = await import('./modals/SettingsModal');
  return { default: module.SettingsModal };
});
const LazyLoginModal = lazy(async () => {
  const module = await import('./modals/LoginModal');
  return { default: module.LoginModal };
});
const LazyRegisterModal = lazy(async () => {
  const module = await import('./modals/RegisterModal');
  return { default: module.RegisterModal };
});
const LazyImageGenerationPanel = lazy(async () => {
  const module = await import('./panels/ImageGenerationPanel');
  return { default: module.ImageGenerationPanel };
});
const LazyImageModificationPanel = lazy(async () => {
  const module = await import('./panels/ImageModificationPanel');
  return { default: module.ImageModificationPanel };
});
const LazyVideoGenerationConfigPanel = lazy(async () => {
  const module = await import('./panels/VideoGenerationConfigPanel');
  return { default: module.VideoGenerationConfigPanel };
});
const LazyMapsGroundingConfigPanel = lazy(async () => {
  const module = await import('./panels/MapsGroundingConfigPanel');
  return { default: module.MapsGroundingConfigPanel };
});

export const DeferredUiFallback: React.FC = () => null;

export interface AppOverlaysProps {
  llmConfigs: LLMConfig[];
  localLLMProfiles: LocalLLMProfile[];
  onSaveSettings: (llmConfigs: LLMConfig[]) => void;
  onImageGenerated: (nodeId: string, imageBase64: string) => void;
  onOpenImageModificationPanel: (
    nodeId: string,
    sourceImage: string,
    agent?: Agent,
    agentInstance?: AgentInstance,
    mimeType?: string,
  ) => void;
  onImageModified: (nodeId: string, newImage: string, text: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onOpenMapsPanel: (nodeId: string, preloadedResults?: MapsPanelPreloadedResults) => void;
  onOpenFullscreen: (src: string, mimeType: string) => void;
}

export const AppOverlays: React.FC<AppOverlaysProps> = ({
  llmConfigs,
  localLLMProfiles,
  onSaveSettings,
  onImageGenerated,
  onOpenImageModificationPanel,
  onImageModified,
  onDeleteNode,
  onOpenMapsPanel,
  onOpenFullscreen,
}) => {
  const { t } = useLocalization();

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
  const currentMapsNodeId = useAppShellStore((state) => state.currentMapsNodeId);
  const editingImageInfo = useAppShellStore((state) => state.editingImageInfo);
  const mapsPreloadedResults = useAppShellStore((state) => state.mapsPreloadedResults);
  const fullscreenImage = useAppShellStore((state) => state.fullscreenImage);

  const setSettingsModalOpen = useAppShellStore((state) => state.setSettingsModalOpen);
  const setLoginModalOpen = useAppShellStore((state) => state.setLoginModalOpen);
  const setRegisterModalOpen = useAppShellStore((state) => state.setRegisterModalOpen);
  const setImagePanelOpen = useAppShellStore((state) => state.setImagePanelOpen);
  const setImageModificationPanelOpen = useAppShellStore((state) => state.setImageModificationPanelOpen);
  const setVideoPanelOpen = useAppShellStore((state) => state.setVideoPanelOpen);
  const setMapsPanelOpen = useAppShellStore((state) => state.setMapsPanelOpen);
  const setMapsPreloadedResults = useAppShellStore((state) => state.setMapsPreloadedResults);
  const setFullscreenImage = useAppShellStore((state) => state.setFullscreenImage);

  return (
    <>
      {isSettingsModalOpen && (
        <Suspense fallback={<DeferredUiFallback />}>
          <LazySettingsModal llmConfigs={llmConfigs} onClose={() => setSettingsModalOpen(false)} onSave={onSaveSettings} />
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
            onImageGenerated={onImageGenerated}
            onOpenImageModificationPanel={onOpenImageModificationPanel}
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
            onImageModified={onImageModified}
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
        onDeleteNode={onDeleteNode}
        onOpenMapsPanel={onOpenMapsPanel}
        onOpenFullscreen={onOpenFullscreen}
        onOpenImageModificationPanel={onOpenImageModificationPanel}
        onImageGenerated={onImageGenerated}
      />

      {/* Configuration Modal */}
      <AgentConfigurationModal llmConfigs={llmConfigs} localLLMProfiles={localLLMProfiles} />

      <NotificationDisplay />
    </>
  );
};

/**
 * 🎬 COMPONENT: VideoGenerationConfigPanel
 * 
 * Wrapper modal pour VideoGenerationContent
 * - Gère l'affichage en SlideOver OU contenu pur
 * - Délègue la logique métier à VideoGenerationContent
 */

import React from 'react';
import { SlideOver } from '../UI';
import { VideoGenerationContent } from './VideoGenerationContent';
import { useLocalization } from '../../hooks/useLocalization';

interface VideoGenerationConfigPanelProps {
  isOpen: boolean;
  onClose: () => void;
  hideSlideOver?: boolean;
}

export const VideoGenerationConfigPanel: React.FC<VideoGenerationConfigPanelProps> = ({
  isOpen,
  onClose,
  hideSlideOver = false
}) => {
  const { t } = useLocalization();

  // Si hideSlideOver=true, afficher toujours (c'est pour HoloPanel)
  // Sinon, afficher seulement si isOpen=true (c'est pour SlideOver)
  if (!hideSlideOver && !isOpen) return null;

  // Si hideSlideOver, afficher juste le contenu sans le wrapper modal
  if (hideSlideOver) {
    return (
      <div className="w-full h-full bg-gray-900/50 text-white overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-gradient-to-r from-cyan-900/30 to-emerald-900/30 border-b border-cyan-500/20 px-6 py-4 flex items-center justify-between flex-shrink-0">
          <h2 className="text-lg font-semibold flex items-center gap-2 text-cyan-300">
            🎬 {t('videoGen_title')}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-cyan-400 text-2xl leading-none transition-colors"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <VideoGenerationContent
            onClose={onClose}
            onSubmit={(config) => {
              console.log('Video generation config:', config);
              // TODO: Implementer l'envoi au LLM
            }}
          />
        </div>
      </div>
    );
  }

  // Sinon, afficher avec le wrapper modal (SlideOver)
  return (
    <SlideOver isOpen={isOpen} onClose={onClose} title={`🎬 ${t('videoGen_title')}`}>
      <VideoGenerationContent
        onClose={onClose}
        onSubmit={(config) => {
          console.log('Video generation config:', config);
          // TODO: Implementer l'envoi au LLM
        }}
      />
    </SlideOver>
  );
};

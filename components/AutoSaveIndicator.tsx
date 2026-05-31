/**
 * @file AutoSaveIndicator.tsx
 * @description Indicateur visuel de l'état de sauvegarde automatique
 * @domain Design Domain - Persistence UI
 * 
 * ⭐ PLAN_DE_PERSISTENCE: Mode Automatique - Indicateur d'état
 * 
 * DESIGN SPEC (BLUR GAME STYLE):
 * - Position: Coin inférieur droit, au-dessus de la MiniMap
 * - Style discret mais visible
 * - Animation subtile lors de la sauvegarde
 * - Visible uniquement si saveMode === 'auto' && isAuthenticated
 * 
 * STATES:
 * - idle: Invisible ou très discret
 * - pending: Indicateur de changement détecté
 * - saving: Animation pulse + texte "Sauvegarde..."
 * - saved: Checkmark vert + texte "Enregistré" (disparaît après 3s)
 * - error: Indicateur rouge + message d'erreur
 */

import React from 'react';
import { AutoSaveStatus } from '../hooks/useAutoSave';

interface AutoSaveIndicatorProps {
  /** Current auto-save status */
  status: AutoSaveStatus;
  /** Last saved timestamp */
  lastSavedAt: Date | null;
  /** Error message (if any) */
  error: string | null;
  /** Is auto-save enabled */
  isEnabled: boolean;
  /** Custom className */
  className?: string;
}

export const AutoSaveIndicator: React.FC<AutoSaveIndicatorProps> = ({
  status,
  lastSavedAt,
  error,
  isEnabled,
  className = ''
}) => {
  // Don't render if auto-save is disabled
  if (!isEnabled) return null;

  // Signal UI hydration readiness when this control first appears
  React.useEffect(() => {
    try {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        try {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new Event('hydration:components:ready'));
          }
        } catch (e) {
          // ignore
        }
      }));
    } catch (e) {
      // ignore
    }
  }, []);

  // Don't render idle state (too noisy)
  if (status === 'idle' && !lastSavedAt) return null;

  /**
   * Get status configuration
   */
  const getStatusConfig = () => {
    switch (status) {
      case 'pending':
        return {
          icon: '●',
          text: 'Modifications...',
          color: 'text-amber-400',
          bgColor: 'bg-amber-500/10',
          borderColor: 'border-amber-500/30',
          animate: 'animate-pulse'
        };
      case 'saving':
        return {
          icon: '◐',
          text: 'Sauvegarde...',
          color: 'text-cyan-400',
          bgColor: 'bg-cyan-500/10',
          borderColor: 'border-cyan-500/30',
          animate: 'animate-spin'
        };
      case 'saved':
        return {
          icon: '✓',
          text: lastSavedAt ? `Enregistré ${formatTime(lastSavedAt)}` : 'Enregistré',
          color: 'text-green-400',
          bgColor: 'bg-green-500/10',
          borderColor: 'border-green-500/30',
          animate: ''
        };
      case 'error':
        return {
          icon: '✗',
          text: error || 'Erreur',
          color: 'text-red-400',
          bgColor: 'bg-red-500/10',
          borderColor: 'border-red-500/30',
          animate: ''
        };
      default: // idle
        return {
          icon: '○',
          text: lastSavedAt ? `Dernière sauvegarde ${formatTime(lastSavedAt)}` : 'Auto-save actif',
          color: 'text-gray-400',
          bgColor: 'bg-gray-500/10',
          borderColor: 'border-gray-500/30',
          animate: ''
        };
    }
  };

  const config = getStatusConfig();

  return (
    <>
      <style>{`
        @keyframes autosave-fade-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        .autosave-indicator {
          animation: autosave-fade-in 0.3s ease;
        }
        
        .autosave-spin {
          animation: autosave-icon-spin 1s linear infinite;
        }
        
        @keyframes autosave-icon-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
      
      <div
        className={`
          autosave-indicator
          flex items-center gap-2 
          px-3 py-1.5 
          rounded-lg
          border
          backdrop-blur-sm
          text-xs font-medium
          transition-all duration-300
          ${config.bgColor}
          ${config.borderColor}
          ${config.color}
          ${className}
        `}
        title={error || undefined}
      >
        <span 
          className={`
            text-sm font-bold
            ${status === 'saving' ? 'autosave-spin' : ''}
            ${status === 'pending' ? 'animate-pulse' : ''}
          `}
        >
          {config.icon}
        </span>
        <span className="whitespace-nowrap">
          {config.text}
        </span>
      </div>
    </>
  );
};

/**
 * Format timestamp relative to now
 */
function formatTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  
  if (seconds < 5) return 'à l\'instant';
  if (seconds < 60) return `il y a ${seconds}s`;
  
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `il y a ${minutes}min`;
  
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours}h`;
  
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export default AutoSaveIndicator;

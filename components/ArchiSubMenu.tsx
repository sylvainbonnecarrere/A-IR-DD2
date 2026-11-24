import React, { useRef, useEffect } from 'react';
import { RobotMenuItem, RobotId } from '../types';

import { useLocalization } from '../hooks/useLocalization';

interface ArchiSubMenuProps {
  /** Items de navigation spécifiques à Archi */
  nestedItems: RobotMenuItem[];
  /** Path actuel pour la sélection active */
  currentPath: string;
  /** Callback de navigation */
  onNavigate: (robotId: RobotId, path: string) => void;
  /** Callback de fermeture (click outside) */
  onClose: () => void;
  /** Position pour l'adjacence à l'IconSidebar */
  position?: { top: number; left: number };
}

/**
 * ArchiSubMenu - Composant de navigation spécialisé pour le robot Archi
 *
 * Selon le plan architectural V2, ce composant doit :
 * 1. Être rendu en position ABSOLUE, adjacent à la IconSidebar (à droite)
 * 2. Afficher uniquement les nestedItems d'Archi
 * 3. Être visible uniquement si currentPath.startsWith('/archi')
 * 4. Permettre l'accès facile à /archi/prototype et autres routes secondaires
 *
 * Architecture : CrewAI + N8N avec 5 robots spécialisés
 * Robot Archi : Architecte créateur de prototypes d'agents et orchestrateur système
 */
export const ArchiSubMenu: React.FC<ArchiSubMenuProps> = ({
  nestedItems,
  currentPath,
  onNavigate,
  onClose,
  position = { top: 0, left: 64 },
}) => {
  const { t } = useLocalization();
  const menuRef = useRef<HTMLDivElement>(null);

  // Click outside handler pour fermer le menu
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // Navigation handler
  const handleNavigation = (item: RobotMenuItem) => {
    onNavigate(item.id, item.path);
    onClose(); // Fermer après navigation
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-gray-800 border border-gray-600 rounded-lg shadow-xl min-w-[240px]"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
        // Style laser/gaming conformément au V2 UX
        background: 'linear-gradient(135deg, #1f2937 0%, #111827 100%)',
        borderColor: '#4f46e5',
        boxShadow: '0 0 20px rgba(79, 70, 229, 0.3), 0 4px 6px -1px rgba(0, 0, 0, 0.1)',
      }}
    >
      {/* Header du submenu */}
      <div className="px-4 py-3 border-b border-gray-600">
        <h3 className="text-sm font-semibold text-indigo-400 uppercase tracking-wide">{t('archi_prototyping_header')}</h3>
        <p className="text-xs text-gray-400 mt-1">{t('archi_prototyping_desc')}</p>
      </div>

      {/* Items de navigation */}
      <div className="py-2">
        {nestedItems.map((item) => {
          const isActive = currentPath === item.path || currentPath.startsWith(item.path + '/');
          const IconComponent = item.iconComponent;

          return (
            <button
              key={item.path}
              onClick={() => handleNavigation(item)}
              className={`
                w-full px-4 py-3 flex items-center space-x-3 text-left transition-all duration-200
                hover:bg-indigo-500/20 hover:border-l-2 hover:border-indigo-400
                ${isActive ? 'bg-indigo-500/30 border-l-2 border-indigo-400 text-indigo-300' : 'text-gray-300 hover:text-white'}
              `}
            >
              {/* Icône */}
              <div
                className={`
                w-5 h-5 flex-shrink-0 transition-colors duration-200
                ${isActive ? 'text-indigo-400' : 'text-gray-400'}
              `}
              >
                <IconComponent />
              </div>

              {/* Contenu */}
              <div className="flex-1 min-w-0">
                <div
                  className={`
                  text-sm font-medium transition-colors duration-200
                  ${isActive ? 'text-indigo-300' : 'text-gray-300'}
                `}
                >
                  {t(item.name)}
                </div>
                {item.description && <div className="text-xs text-gray-500 mt-0.5 truncate">{t(item.description)}</div>}
              </div>

              {/* Active indicator */}
              {isActive && <div className="w-2 h-2 bg-indigo-400 rounded-full flex-shrink-0"></div>}
            </button>
          );
        })}
      </div>

      {/* Footer avec raccourci rapide */}
      <div className="px-4 py-2 border-t border-gray-600 bg-gray-900/50">
        <div className="text-xs text-gray-500 flex items-center justify-between">
          <span>ARCHI sur la carte du workflow</span>
          <kbd className="px-1.5 py-0.5 text-xs bg-gray-700 rounded border border-gray-600">Ctrl+Shift+A</kbd>
        </div>
      </div>
    </div>
  );
};

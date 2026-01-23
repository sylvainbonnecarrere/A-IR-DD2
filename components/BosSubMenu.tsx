import React, { useRef, useEffect } from 'react';
import { RobotMenuItem, RobotId } from '../types';
import { useLocalization } from '../hooks/useLocalization';

interface BosSubMenuProps {
  nestedItems: RobotMenuItem[];
  currentPath: string;
  onNavigate: (robotId: RobotId, path: string) => void;
  onClose: () => void;
  position?: { top: number; left: number };
}

/**
 * BosSubMenu - Composant de navigation spécialisé pour le robot Bos
 * Robot Superviseur avec accent rouge/jaune
 */
export const BosSubMenu: React.FC<BosSubMenuProps> = ({
  nestedItems,
  currentPath,
  onNavigate,
  onClose,
  position = { top: 0, left: 64 }
}) => {
  const { t } = useLocalization();
  const menuRef = useRef<HTMLDivElement>(null);

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

  const handleNavigation = (item: RobotMenuItem) => {
    onNavigate(item.id, item.path);
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-gray-800 border border-gray-600 rounded-lg shadow-xl min-w-[240px]"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
        background: 'linear-gradient(135deg, #1f2937 0%, #111827 100%)',
        borderColor: '#eab308',
        boxShadow: '0 0 20px rgba(234, 179, 8, 0.3), 0 4px 6px -1px rgba(0, 0, 0, 0.1)',
      }}
    >
      {/* Header du submenu */}
      <div className="px-4 py-3 border-b border-gray-600">
        <h3 className="text-sm font-semibold text-yellow-400 uppercase tracking-wide">
          {t('bos_supervision_header')}
        </h3>
        <p className="text-xs text-gray-400 mt-1">
          {t('bos_supervision_desc')}
        </p>
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
                hover:bg-yellow-500/20 hover:border-l-2 hover:border-yellow-400
                ${isActive
                  ? 'bg-yellow-500/30 border-l-2 border-yellow-400 text-yellow-300'
                  : 'text-gray-300 hover:text-white'
                }
              `}
            >
              <div className={`
                w-5 h-5 flex-shrink-0 transition-colors duration-200
                ${isActive ? 'text-yellow-400' : 'text-gray-400'}
              `}>
                <IconComponent />
              </div>

              <div className="flex-1 min-w-0">
                <div className={`
                  text-sm font-medium transition-colors duration-200
                  ${isActive ? 'text-yellow-300' : 'text-gray-300'}
                `}>
                  {t(item.name)}
                </div>
                {item.description && (
                  <div className="text-xs text-gray-500 mt-0.5 truncate">
                    {t(item.description)}
                  </div>
                )}
              </div>

              {isActive && (
                <div className="w-2 h-2 bg-yellow-400 rounded-full flex-shrink-0"></div>
              )}
            </button>
          );
        })}
      </div>

      {/* Footer avec raccourci rapide */}
      <div className="px-4 py-2 border-t border-gray-600 bg-gray-900/50">
        <div className="text-xs text-gray-500 flex items-center justify-between">
          <span>BOS sur la carte du workflow</span>
          <kbd className="px-1.5 py-0.5 text-xs bg-gray-700 rounded border border-gray-600">
            Ctrl+Shift+B
          </kbd>
        </div>
      </div>
    </div>
  );
};

export default BosSubMenu;

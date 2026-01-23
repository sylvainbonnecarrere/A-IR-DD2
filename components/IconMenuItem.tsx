import React from 'react';
import { RobotMenuItem, RobotId } from '../types';
import { useLocalization } from '../hooks/useLocalization';

interface IconMenuItemProps {
  item: RobotMenuItem;
  isActive: boolean;
  isSubMenuOpen?: boolean;
  onItemClick: (robotId: RobotId, path: string) => void;
  className?: string;
}

export const IconMenuItem: React.FC<IconMenuItemProps> = ({
  item,
  isActive,
  isSubMenuOpen = false,
  onItemClick,
  className = ''
}) => {
  const { t } = useLocalization();
  const IconComponent = item.iconComponent;

  // Robot color mapping for dynamic states
  const colorMap: { [key in RobotId]: { icon: string; iconMenu: string; background: string; glow: string } } = {
    [RobotId.Archi]: {
      icon: 'text-indigo-400',
      iconMenu: 'text-indigo-300',
      background: 'bg-indigo-600',
      glow: 'shadow-indigo-500/30'
    },
    [RobotId.Bos]: {
      icon: 'text-yellow-400',
      iconMenu: 'text-yellow-300',
      background: 'bg-yellow-600',
      glow: 'shadow-yellow-500/30'
    },
    [RobotId.Com]: {
      icon: 'text-green-400',
      iconMenu: 'text-green-300',
      background: 'bg-green-600',
      glow: 'shadow-green-500/30'
    },
    [RobotId.Phil]: {
      icon: 'text-cyan-400',
      iconMenu: 'text-cyan-300',
      background: 'bg-cyan-600',
      glow: 'shadow-cyan-500/30'
    },
    [RobotId.Tim]: {
      icon: 'text-red-400',
      iconMenu: 'text-red-300',
      background: 'bg-red-600',
      glow: 'shadow-red-500/30'
    }
  };

  const colors = colorMap[item.id];

  const handleClick = () => {
    onItemClick(item.id, item.path);
  };

  return (
    <div
      className={`
        relative group cursor-pointer
        w-12 h-12 rounded-lg
        flex items-center justify-center
        transition-all duration-200
        ${isActive
          ? `${colors.background} text-white shadow-lg ${colors.glow}`
          : isSubMenuOpen
            ? `bg-gray-700 ${colors.iconMenu}`
            : 'bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white'
        }
        ${className}
      `}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      {IconComponent && <IconComponent className="w-6 h-6" />}

      {/* Tooltip */}
      <div className="absolute left-16 bg-gray-900 text-white text-sm px-2 py-1 rounded shadow-lg
                      opacity-0 group-hover:opacity-100 transition-opacity duration-200
                      pointer-events-none whitespace-nowrap z-50">
        {t(item.name)}
        <div className="absolute left-0 top-1/2 transform -translate-y-1/2 -translate-x-1
                        border-4 border-transparent border-r-gray-900"></div>
      </div>
    </div>
  );
};
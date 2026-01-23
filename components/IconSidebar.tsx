import React, { useState } from 'react';
import { RobotMenuItem, RobotId } from '../types';
import { IconMenuItem } from './IconMenuItem';
import { ArchiSubMenu } from './ArchiSubMenu';
import { BosSubMenu } from './BosSubMenu';
import { ComSubMenu } from './ComSubMenu';
import { PhilSubMenu } from './PhilSubMenu';
import { TimSubMenu } from './TimSubMenu';
import { useLocalization } from '../hooks/useLocalization';

interface IconSidebarProps {
  robotMenuData: RobotMenuItem[];
  currentPath: string;
  onNavigate: (robotId: RobotId, path: string) => void;
  className?: string;
}

export const IconSidebar: React.FC<IconSidebarProps> = ({
  robotMenuData,
  currentPath,
  onNavigate,
  className = ''
}) => {
  const [activeSubMenuRobot, setActiveSubMenuRobot] = useState<RobotId | null>(null);

  const handleItemClick = (robotId: RobotId, path: string) => {
    const robot = robotMenuData.find(r => r.id === robotId);

    // Check if robot has nested items for submenu
    if (robot && robot.nestedItems && robot.nestedItems.length > 0) {
      setActiveSubMenuRobot(activeSubMenuRobot === robotId ? null : robotId);
      return;
    }

    // Close any open submenu and navigate
    setActiveSubMenuRobot(null);
    onNavigate(robotId, path);
  };

  const handleSubNavigation = (robotId: RobotId, path: string) => {
    onNavigate(robotId, path);
  };

  const closeSubMenu = () => {
    setActiveSubMenuRobot(null);
  };

  return (
    <aside className={`
      relative w-16 bg-gray-800 border-r border-gray-700/50 
      flex flex-col items-center py-4 space-y-3
      ${className}
    `}>
      {robotMenuData.map((robot, index) => {
        const isActive = currentPath.startsWith(robot.path);
        const hasSubMenu = robot.nestedItems && robot.nestedItems.length > 0;
        const isSubMenuOpen = activeSubMenuRobot === robot.id;

        return (
          <div key={robot.id} className="relative">
            <IconMenuItem
              item={robot}
              isActive={isActive}
              isSubMenuOpen={isSubMenuOpen}
              onItemClick={handleItemClick}
            />

            {/* ARCHI SPECIALIZED SUBMENU */}
            {robot.id === RobotId.Archi && isSubMenuOpen && hasSubMenu && (
              <ArchiSubMenu
                nestedItems={robot.nestedItems}
                currentPath={currentPath}
                onNavigate={handleSubNavigation}
                onClose={closeSubMenu}
                position={{
                  top: index * 56 + 16,
                  left: 64
                }}
              />
            )}

            {/* BOS SPECIALIZED SUBMENU */}
            {robot.id === RobotId.Bos && isSubMenuOpen && hasSubMenu && (
              <BosSubMenu
                nestedItems={robot.nestedItems}
                currentPath={currentPath}
                onNavigate={handleSubNavigation}
                onClose={closeSubMenu}
                position={{
                  top: index * 56 + 16,
                  left: 64
                }}
              />
            )}

            {/* COM SPECIALIZED SUBMENU */}
            {robot.id === RobotId.Com && isSubMenuOpen && hasSubMenu && (
              <ComSubMenu
                nestedItems={robot.nestedItems}
                currentPath={currentPath}
                onNavigate={handleSubNavigation}
                onClose={closeSubMenu}
                position={{
                  top: index * 56 + 16,
                  left: 64
                }}
              />
            )}

            {/* PHIL SPECIALIZED SUBMENU */}
            {robot.id === RobotId.Phil && isSubMenuOpen && hasSubMenu && (
              <PhilSubMenu
                nestedItems={robot.nestedItems}
                currentPath={currentPath}
                onNavigate={handleSubNavigation}
                onClose={closeSubMenu}
                position={{
                  top: index * 56 + 16,
                  left: 64
                }}
              />
            )}

            {/* TIM SPECIALIZED SUBMENU */}
            {robot.id === RobotId.Tim && isSubMenuOpen && hasSubMenu && (
              <TimSubMenu
                nestedItems={robot.nestedItems}
                currentPath={currentPath}
                onNavigate={handleSubNavigation}
                onClose={closeSubMenu}
                position={{
                  top: index * 56 + 16,
                  left: 64
                }}
              />
            )}
          </div>
        );
      })}

      {/* Click outside to close submenu */}
      {activeSubMenuRobot && (
        <div
          className="fixed inset-0 z-40"
          onClick={closeSubMenu}
        />
      )}
    </aside>
  );
};

export default IconSidebar;

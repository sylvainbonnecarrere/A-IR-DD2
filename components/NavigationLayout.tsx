import React from 'react';
import { RobotId } from '../types';
import { IconSidebar } from './IconSidebar';
import { ROBOT_MENU_DATA } from '../data/robotNavigation';

interface NavigationLayoutProps {
  currentPath?: string;
  onNavigate?: (robotId: RobotId, path: string) => void;
}

export const NavigationLayout: React.FC<NavigationLayoutProps> = ({
  currentPath = '/archi/dashboard',
  onNavigate = () => { }
}) => {
  return (
    <IconSidebar
      robotMenuData={ROBOT_MENU_DATA}
      currentPath={currentPath}
      onNavigate={onNavigate}
    />
  );
};
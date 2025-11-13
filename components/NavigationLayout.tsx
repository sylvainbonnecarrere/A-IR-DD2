import React from 'react';
import { RobotId } from '../types';
import { IconSidebar } from './IconSidebar';
import { ROBOT_MENU_DATA } from '../data/robotNavigation';

interface NavigationLayoutProps {
  // Legacy props - kept for potential modal functionality if needed
  agents?: any[];
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onAddAgent?: () => void;
  onAddToWorkflow?: (agent: any) => void;
  onDeleteAgent?: (agentId: string) => void;
  onEditAgent?: (agent: any) => void;

  // V2 navigation props
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
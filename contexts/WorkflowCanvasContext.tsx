import React, { createContext, useContext } from 'react';
import { Agent, AgentInstance, MapsPanelPreloadedResults, NodePositionUpdateOptions, RobotId } from '../types';

interface WorkflowCanvasContextType {
  onEditPrototype?: (nodeId: string) => void;
  navigationHandler?: (robotId: RobotId, path: string) => void;
  onDeleteNode?: (nodeId: string) => void;
  onToggleNodeMinimize?: (nodeId: string) => void;
  onUpdateNodePosition?: (nodeId: string, position: { x: number; y: number }, options?: NodePositionUpdateOptions) => void;
  onOpenImagePanel?: (nodeId: string, agent: Agent, agentInstance: AgentInstance) => void;
  onOpenImageModificationPanel?: (nodeId: string, sourceImage: string, agent?: Agent, agentInstance?: AgentInstance, mimeType?: string) => void;
  onOpenVideoPanel?: (nodeId: string, agent: Agent, agentInstance: AgentInstance) => void;
  onOpenMapsPanel?: (nodeId: string, preloadedResults?: MapsPanelPreloadedResults) => void;
  onOpenFullscreen?: (imageBase64: string, mimeType: string) => void;
}

const WorkflowCanvasContext = createContext<WorkflowCanvasContextType | undefined>(undefined);

export const WorkflowCanvasProvider: React.FC<{
  children: React.ReactNode;
  value: WorkflowCanvasContextType;
}> = ({ children, value }) => {
  return (
    <WorkflowCanvasContext.Provider value={value}>
      {children}
    </WorkflowCanvasContext.Provider>
  );
};

export const useWorkflowCanvasContext = () => {
  const context = useContext(WorkflowCanvasContext);
  if (!context) {
    throw new Error('useWorkflowCanvasContext must be used within a WorkflowCanvasProvider');
  }
  return context;
};
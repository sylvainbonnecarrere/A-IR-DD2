import React, { createContext, useContext } from 'react';

interface WorkflowCanvasContextType {
  onEditPrototype?: (nodeId: string) => void;
  navigationHandler?: (robotId: string, path: string) => void;
  onDeleteNode?: (nodeId: string) => void;
  onToggleNodeMinimize?: (nodeId: string) => void;
  onUpdateNodePosition?: (nodeId: string, position: { x: number; y: number }) => void;
  onOpenImagePanel?: (nodeId: string) => void;
  onOpenImageModificationPanel?: (nodeId: string, sourceImage: string, mimeType?: string) => void;
  onOpenVideoPanel?: (nodeId: string) => void;
  onOpenMapsPanel?: (nodeId: string) => void;
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
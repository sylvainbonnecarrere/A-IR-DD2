import React from 'react';
import { RobotId, LLMConfig, Agent, WorkflowNode } from '../types';
import { ArchiPrototypingPage } from './ArchiPrototypingPage';
import WorkflowCanvas from './WorkflowCanvas';
import { ComConnectionsPage } from './ComConnectionsPage';
import { PhilDataPage } from './PhilDataPage';
import { TimEventsPage } from './TimEventsPage';
import { useLocalization } from '../hooks/useLocalization';

interface RobotPageRouterProps {
  currentPath: string;
  llmConfigs: LLMConfig[];
  onNavigate?: (robotId: RobotId, path: string) => void;
  // Props pour WorkflowCanvas
  agents?: Agent[];
  workflowNodes?: WorkflowNode[];
  onDeleteNode?: (nodeId: string) => void;
  onUpdateNodeMessages?: (nodeId: string, messages: any[]) => void;
  onUpdateNodePosition?: (nodeId: string, position: { x: number; y: number }) => void;
  onToggleNodeMinimize?: (nodeId: string) => void;
  onOpenImagePanel?: (nodeId: string) => void;
  onOpenImageModificationPanel?: (nodeId: string) => void;
  onOpenVideoPanel?: (nodeId: string) => void;
  onOpenMapsPanel?: (nodeId: string) => void;
  onOpenFullscreen?: (nodeId: string) => void;
  onAddToWorkflow?: (agent: Agent) => void;
}

// Page with workflow canvas for operational robots
const WorkflowPage: React.FC<{
  robotName: string;
  description: string;
  // Props WorkflowCanvas
  agents?: Agent[];
  workflowNodes?: WorkflowNode[];
  llmConfigs: LLMConfig[];
  onDeleteNode?: (nodeId: string) => void;
  onUpdateNodeMessages?: (nodeId: string, messages: any[]) => void;
  onUpdateNodePosition?: (nodeId: string, position: { x: number; y: number }) => void;
  onToggleNodeMinimize?: (nodeId: string) => void;
  onOpenImagePanel?: (nodeId: string) => void;
  onOpenImageModificationPanel?: (nodeId: string) => void;
  onOpenVideoPanel?: (nodeId: string) => void;
  onOpenMapsPanel?: (nodeId: string) => void;
  onOpenFullscreen?: (nodeId: string) => void;
  onAddToWorkflow?: (agent: Agent) => void;
  onAddToWorkflow?: (agent: Agent) => void;
}> = ({
  robotName,
  description,
  agents,
  workflowNodes,
  llmConfigs,
  onDeleteNode,
  onUpdateNodeMessages,
  onUpdateNodePosition,
  onToggleNodeMinimize,
  onOpenImagePanel,
  onOpenImageModificationPanel,
  onOpenVideoPanel,
  onOpenMapsPanel,
  onOpenFullscreen,
  onAddToWorkflow
}) => {
    return (
      <div className="h-full flex flex-col bg-gray-900 text-gray-100">
        {/* Header */}
        <div className="p-4 border-b border-gray-700">
          <h1 className="text-xl font-bold text-white">{robotName}</h1>
          <p className="text-gray-400 text-sm">{description}</p>
        </div>

        {/* Workflow Canvas avec toutes les props nécessaires */}
        <div className="flex-1">
          <WorkflowCanvas
            nodes={workflowNodes}
            agents={agents}
            llmConfigs={llmConfigs}
            onDeleteNode={onDeleteNode}
            onUpdateNodeMessages={onUpdateNodeMessages}
            onUpdateNodePosition={onUpdateNodePosition}
            onToggleNodeMinimize={onToggleNodeMinimize}
            onOpenImagePanel={onOpenImagePanel}
            onOpenImageModificationPanel={onOpenImageModificationPanel}
            onOpenVideoPanel={onOpenVideoPanel}
            onOpenMapsPanel={onOpenMapsPanel}
            onOpenFullscreen={onOpenFullscreen}
            onAddToWorkflow={onAddToWorkflow}
          />
        </div>
      </div>
    );
  };

// Placeholder components for pages without workflow
const PlaceholderPage: React.FC<{ robotName: string; description: string }> = ({ robotName, description }) => {
  return (
    <div className="h-full bg-gray-900 text-gray-100 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-indigo-400 mb-4">{robotName}</h1>
        <p className="text-gray-400 text-lg">{description}</p>
        <p className="text-gray-500 text-sm mt-4">Interface en cours de développement...</p>
      </div>
    </div>
  );
};

export const RobotPageRouter: React.FC<RobotPageRouterProps> = ({
  currentPath,
  llmConfigs,
  onNavigate,
  agents,
  workflowNodes,
  onDeleteNode,
  onUpdateNodeMessages,
  onUpdateNodePosition,
  onToggleNodeMinimize,
  onOpenImagePanel,
  onOpenImageModificationPanel,
  onOpenVideoPanel,
  onOpenMapsPanel,
  onOpenFullscreen,
  onAddToWorkflow
}) => {
  const { t } = useLocalization();

  // Navigation helper to go to workflow map (Bos Dashboard)
  const handleNavigateToWorkflow = () => {
    if (onNavigate) {
      onNavigate('bos', '/bos/dashboard');
    }
  };

  // Props communes pour les WorkflowPage
  const workflowProps = {
    agents,
    workflowNodes,
    llmConfigs,
    onDeleteNode,
    onUpdateNodeMessages,
    onUpdateNodePosition,
    onToggleNodeMinimize,
    onOpenImagePanel,
    onOpenImageModificationPanel,
    onOpenVideoPanel,
    onOpenMapsPanel,
    onOpenFullscreen,
    onAddToWorkflow
  };

  // Route matching logic
  if (currentPath.startsWith('/archi/prototype')) {
    return <ArchiPrototypingPage llmConfigs={llmConfigs} onNavigateToWorkflow={handleNavigateToWorkflow} onAddToWorkflow={onAddToWorkflow} />;
  }

  if (currentPath.startsWith('/archi')) {
    return <ArchiPrototypingPage llmConfigs={llmConfigs} onNavigateToWorkflow={handleNavigateToWorkflow} onAddToWorkflow={onAddToWorkflow} />;
  }

  if (currentPath.startsWith('/bos/dashboard')) {
    return (
      <WorkflowPage
        robotName="Dashboard - Carte des Workflows"
        description="Vue d'ensemble cartographique de tous les workflows et leur statut"
        {...workflowProps}
      />
    );
  }

  if (currentPath.startsWith('/bos')) {
    return (
      <WorkflowPage
        robotName="Bos Supervision"
        description="Outils de supervision, debugging et monitoring des coûts"
        {...workflowProps}
      />
    );
  }

  if (currentPath.startsWith('/com')) {
    return (
      <ComConnectionsPage
        llmConfigs={llmConfigs}
        onNavigateToWorkflow={handleNavigateToWorkflow}
      />
    );
  }

  if (currentPath.startsWith('/phil')) {
    return (
      <PhilDataPage
        llmConfigs={llmConfigs}
        onNavigateToWorkflow={handleNavigateToWorkflow}
      />
    );
  }

  if (currentPath.startsWith('/tim')) {
    return (
      <TimEventsPage
        llmConfigs={llmConfigs}
        onNavigateToWorkflow={handleNavigateToWorkflow}
      />
    );
  }

  // Default fallback
  return (
    <PlaceholderPage
      robotName="Workflow Orchestrator"
      description="Sélectionnez un robot dans la navigation pour commencer"
    />
  );
};

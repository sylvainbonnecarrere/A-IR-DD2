import React, { useMemo, useState } from 'react';
import { RobotId, LLMConfig, Agent, WorkflowNode, AgentInstance, AgentBatchDeleteResult, AgentDeletionMediaPolicy } from '../types';
import { ArchiPrototypingPage } from './ArchiPrototypingPage';
import WorkflowCanvas from './WorkflowCanvas';
import { ComConnectionsPage } from './ComConnectionsPage';
import { ComDatabasesPage } from './ComDatabasesPage';
import { ComApiPage } from './ComApiPage';
import { PhilDataPage } from './PhilDataPage';
import { PhilFunctionsPage } from './PhilFunctionsPage';
import { TimEventsPage } from './TimEventsPage';
import BosWorkflowManagementPage from './BosWorkflowManagementPage';
import BosMediaModal from './modals/BosMediaModal';
import { useLocalization } from '../hooks/useLocalization';
import { useDesignStore } from '../stores/useDesignStore';

interface RobotPageRouterProps {
  currentPath: string;
  llmConfigs: LLMConfig[];
  onNavigate?: (robotId: RobotId, path: string) => void;
  // Props pour WorkflowCanvas
  agents?: Agent[];
  workflowNodes?: WorkflowNode[];
  onDeleteNode?: (nodeId: string) => void;
  onDeleteNodes?: (instanceIds: string[], mediaPolicy: AgentDeletionMediaPolicy) => Promise<AgentBatchDeleteResult> | AgentBatchDeleteResult; // Batch delete nodes by instanceId
  onUpdateNodeMessages?: (nodeId: string, messages: any[]) => void;
  onUpdateNodePosition?: (nodeId: string, position: { x: number; y: number }) => void;
  onToggleNodeMinimize?: (nodeId: string) => void;
  onToggleNodeMaximize?: (nodeId: string) => void;
  onOpenImagePanel?: (nodeId: string, agent: Agent, agentInstance: AgentInstance) => void;
  onOpenImageModificationPanel?: (nodeId: string, sourceImage: string, agent?: Agent, agentInstance?: AgentInstance, mimeType?: string) => void;
  onOpenVideoPanel?: (nodeId: string, agent: Agent, agentInstance: AgentInstance) => void;
  onOpenMapsPanel?: (nodeId: string, preloadedResults?: { text: string; mapSources: any[]; query?: string }) => void;
  onOpenFullscreen?: (imageBase64: string, mimeType: string) => void;
  onAddToWorkflow?: (agent: Agent) => void;
  // Détection panneaux actifs
  isImagePanelOpen?: boolean;
  isImageModificationPanelOpen?: boolean;
  isVideoPanelOpen?: boolean;
  isMapsPanelOpen?: boolean;
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
  onToggleNodeMaximize?: (nodeId: string) => void;
  onOpenImagePanel?: (nodeId: string, agent: Agent, agentInstance: AgentInstance) => void;
  onOpenImageModificationPanel?: (nodeId: string, sourceImage: string, agent?: Agent, agentInstance?: AgentInstance, mimeType?: string) => void;
  onOpenVideoPanel?: (nodeId: string, agent: Agent, agentInstance: AgentInstance) => void;
  onOpenMapsPanel?: (nodeId: string, preloadedResults?: { text: string; mapSources: any[]; query?: string }) => void;
  onOpenFullscreen?: (imageBase64: string, mimeType: string) => void;
  onAddToWorkflow?: (agent: Agent) => void;
  isImagePanelOpen?: boolean;
  isImageModificationPanelOpen?: boolean;
  isVideoPanelOpen?: boolean;
  isMapsPanelOpen?: boolean;
  headerActions?: React.ReactNode;
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
  onToggleNodeMaximize,
  onOpenImagePanel,
  onOpenImageModificationPanel,
  onOpenVideoPanel,
  onOpenMapsPanel,
  onOpenFullscreen,
  onAddToWorkflow,
  isImagePanelOpen,
  isImageModificationPanelOpen,
  isVideoPanelOpen,
  isMapsPanelOpen,
  headerActions
}) => {
    return (
      <div className="h-full flex flex-col bg-gray-900 text-gray-100">
        {/* Header */}
        <div className="p-4 border-b border-gray-700 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-white">{robotName}</h1>
            <p className="text-gray-400 text-sm">{description}</p>
          </div>
          {headerActions ? (
            <div className="flex items-center gap-3">
              {headerActions}
            </div>
          ) : null}
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
            onToggleNodeMaximize={onToggleNodeMaximize}
            onOpenImagePanel={onOpenImagePanel}
            onOpenImageModificationPanel={onOpenImageModificationPanel}
            onOpenVideoPanel={onOpenVideoPanel}
            onOpenMapsPanel={onOpenMapsPanel}
            onOpenFullscreen={onOpenFullscreen}
            onAddToWorkflow={onAddToWorkflow}
            isImagePanelOpen={isImagePanelOpen}
            isImageModificationPanelOpen={isImageModificationPanelOpen}
            isVideoPanelOpen={isVideoPanelOpen}
            isMapsPanelOpen={isMapsPanelOpen}
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
  onDeleteNodes,
  onUpdateNodeMessages,
  onUpdateNodePosition,
  onToggleNodeMinimize,
  onToggleNodeMaximize,
  onOpenImagePanel,
  onOpenImageModificationPanel,
  onOpenVideoPanel,
  onOpenMapsPanel,
  onOpenFullscreen,
  onAddToWorkflow,
  isImagePanelOpen,
  isImageModificationPanelOpen,
  isVideoPanelOpen,
  isMapsPanelOpen
}) => {
  const { t } = useLocalization();
  const { workflows, currentWorkflowId } = useDesignStore();
  const [showBosMediaModal, setShowBosMediaModal] = useState(false);
  const activeWorkflow = useMemo(
    () => workflows.find((workflow) => workflow._id === currentWorkflowId) ?? workflows[0] ?? null,
    [currentWorkflowId, workflows],
  );

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
    onToggleNodeMaximize,
    onOpenImagePanel,
    onOpenImageModificationPanel,
    onOpenVideoPanel,
    onOpenMapsPanel,
    onOpenFullscreen,
    onAddToWorkflow,
    isImagePanelOpen,
    isImageModificationPanelOpen,
    isVideoPanelOpen,
    isMapsPanelOpen
  };

  const bosMediaHeaderAction = (
    <>
      <button
        type="button"
        onClick={() => setShowBosMediaModal(true)}
        disabled={!activeWorkflow}
        className="rounded-lg border border-yellow-400/50 bg-yellow-500 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-yellow-400 disabled:cursor-not-allowed disabled:border-gray-700 disabled:bg-gray-800 disabled:text-gray-500"
      >
        {t('bos_media_button', 'Media')}
      </button>
      <BosMediaModal
        isOpen={showBosMediaModal}
        workflowId={activeWorkflow?._id ?? null}
        workflowName={activeWorkflow?.name ?? null}
        onClose={() => setShowBosMediaModal(false)}
      />
    </>
  );

  // Route matching logic
  if (currentPath.startsWith('/archi/prototype')) {
    return <ArchiPrototypingPage llmConfigs={llmConfigs} onNavigateToWorkflow={handleNavigateToWorkflow} onAddToWorkflow={onAddToWorkflow} onDeleteNodes={onDeleteNodes} />;
  }

  if (currentPath.startsWith('/archi')) {
    return <ArchiPrototypingPage llmConfigs={llmConfigs} onNavigateToWorkflow={handleNavigateToWorkflow} onAddToWorkflow={onAddToWorkflow} onDeleteNodes={onDeleteNodes} />;
  }

  if (currentPath.startsWith('/bos/dashboard')) {
    return (
      <WorkflowPage
        robotName={t('page_dashboard_title')}
        description={t('page_dashboard_description')}
        headerActions={bosMediaHeaderAction}
        {...workflowProps}
      />
    );
  }

  // ⭐ NEW - BOS Workflow Management Page
  if (currentPath.startsWith('/bos/workflows/manage')) {
    return (
      <div className="h-full">
        <BosWorkflowManagementPage />
      </div>
    );
  }

  if (currentPath.startsWith('/bos')) {
    return (
      <WorkflowPage
        robotName={t('page_bos_supervision_title')}
        description={t('page_bos_supervision_description')}
        headerActions={bosMediaHeaderAction}
        {...workflowProps}
      />
    );
  }

  if (currentPath.startsWith('/com/connexions-api')) {
    return <ComApiPage />;
  }

  if (currentPath.startsWith('/com/databases')) {
    return <ComDatabasesPage />;
  }

  if (currentPath.startsWith('/com')) {
    return <ComApiPage />;
  }

  if (currentPath.startsWith('/phil/functions')) {
    return <PhilFunctionsPage />;
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
      robotName={t('page_orchestrator_title')}
      description={t('page_orchestrator_description')}
    />
  );
};

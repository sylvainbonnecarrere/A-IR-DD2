import React, { Suspense, lazy, useMemo, useState } from 'react';
import { RobotId, LLMConfig, Agent, AgentInstance, AgentBatchDeleteResult, AgentDeletionMediaPolicy, NodePositionUpdateOptions, ChatMessage, MapsPanelPreloadedResults } from '../types';
import { useLocalization } from '../hooks/useLocalization';
import { useDesignStore } from '../stores/useDesignStore';
import { publishHydrationComponentReady } from '../utils/hydrationComponentReadiness';
import { ROBOT_PAGE_ROUTE_IDS, resolveRobotPageRoute } from '../utils/robotPageRouting';

const LazyWorkflowCanvas = lazy(() => import('./WorkflowCanvas'));
const LazyArchiPrototypingPage = lazy(async () => {
  const module = await import('./ArchiPrototypingPage');
  return { default: module.ArchiPrototypingPage };
});
const LazyComDatabasesPage = lazy(async () => {
  const module = await import('./ComDatabasesPage');
  return { default: module.ComDatabasesPage };
});
const LazyComApiPage = lazy(async () => {
  const module = await import('./ComApiPage');
  return { default: module.ComApiPage };
});
const LazyPhilDataPage = lazy(async () => {
  const module = await import('./PhilDataPage');
  return { default: module.PhilDataPage };
});
const LazyPhilFunctionsPage = lazy(async () => {
  const module = await import('./PhilFunctionsPage');
  return { default: module.PhilFunctionsPage };
});
const LazyTimEventsPage = lazy(async () => {
  const module = await import('./TimEventsPage');
  return { default: module.TimEventsPage };
});
const LazyBosWorkflowManagementPage = lazy(() => import('./BosWorkflowManagementPage'));
const LazyBosMediaModal = lazy(() => import('./modals/BosMediaModal'));

interface RobotPageRouterProps {
  currentPath: string;
  llmConfigs: LLMConfig[];
  onNavigate?: (robotId: RobotId, path: string) => void;
  onWorkflowCanvasReady?: () => void;
  // Props pour WorkflowCanvas
  agents?: Agent[];
  onDeleteNode?: (nodeId: string) => void;
  onDeleteNodes?: (instanceIds: string[], mediaPolicy: AgentDeletionMediaPolicy) => Promise<AgentBatchDeleteResult> | AgentBatchDeleteResult; // Batch delete nodes by instanceId
  onUpdateNodeMessages?: (nodeId: string, messages: ChatMessage[]) => void;
  onUpdateNodePosition?: (nodeId: string, position: { x: number; y: number }, options?: NodePositionUpdateOptions) => void;
  onToggleNodeMinimize?: (nodeId: string) => void;
  onOpenImagePanel?: (nodeId: string, agent: Agent, agentInstance: AgentInstance) => void;
  onOpenImageModificationPanel?: (nodeId: string, sourceImage: string, agent?: Agent, agentInstance?: AgentInstance, mimeType?: string) => void;
  onOpenVideoPanel?: (nodeId: string, agent: Agent, agentInstance: AgentInstance) => void;
  onOpenMapsPanel?: (nodeId: string, preloadedResults?: MapsPanelPreloadedResults) => void;
  onOpenFullscreen?: (imageBase64: string, mimeType: string) => void;
  onAddToWorkflow?: (agent: Agent) => void;
}

// Page with workflow canvas for operational robots
const WorkflowPage: React.FC<{
  robotName: string;
  description: string;
  // Props WorkflowCanvas
  agents?: Agent[];
  llmConfigs: LLMConfig[];
  onWorkflowCanvasReady?: () => void;
  onDeleteNode?: (nodeId: string) => void;
  onUpdateNodeMessages?: (nodeId: string, messages: ChatMessage[]) => void;
  onUpdateNodePosition?: (nodeId: string, position: { x: number; y: number }, options?: NodePositionUpdateOptions) => void;
  onToggleNodeMinimize?: (nodeId: string) => void;
  onOpenImagePanel?: (nodeId: string, agent: Agent, agentInstance: AgentInstance) => void;
  onOpenImageModificationPanel?: (nodeId: string, sourceImage: string, agent?: Agent, agentInstance?: AgentInstance, mimeType?: string) => void;
  onOpenVideoPanel?: (nodeId: string, agent: Agent, agentInstance: AgentInstance) => void;
  onOpenMapsPanel?: (nodeId: string, preloadedResults?: MapsPanelPreloadedResults) => void;
  onOpenFullscreen?: (imageBase64: string, mimeType: string) => void;
  onAddToWorkflow?: (agent: Agent) => void;
  headerActions?: React.ReactNode;
}> = ({
  robotName,
  description,
  agents,
  llmConfigs,
  onWorkflowCanvasReady,
  onDeleteNode,
  onUpdateNodeMessages,
  onUpdateNodePosition,
  onToggleNodeMinimize,
  onOpenImagePanel,
  onOpenImageModificationPanel,
  onOpenVideoPanel,
  onOpenMapsPanel,
  onOpenFullscreen,
  onAddToWorkflow,
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
          <Suspense fallback={<RouteFallback message="Chargement du workflow..." />}>
            <LazyWorkflowCanvas
              agents={agents}
              llmConfigs={llmConfigs}
              onCanvasReady={onWorkflowCanvasReady}
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
          </Suspense>
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

const RouteFallback: React.FC<{ message?: string }> = ({ message = 'Chargement de la page...' }) => (
  <div className="flex h-full items-center justify-center bg-gray-900 text-gray-300">
    <div className="rounded-lg border border-gray-700 bg-gray-800/60 px-4 py-3 text-sm">
      {message}
    </div>
  </div>
);

export const RobotPageRouter: React.FC<RobotPageRouterProps> = ({
  currentPath,
  llmConfigs,
  onNavigate,
  onWorkflowCanvasReady,
  agents,
  onDeleteNode,
  onDeleteNodes,
  onUpdateNodeMessages,
  onUpdateNodePosition,
  onToggleNodeMinimize,
  onOpenImagePanel,
  onOpenImageModificationPanel,
  onOpenVideoPanel,
  onOpenMapsPanel,
  onOpenFullscreen,
  onAddToWorkflow,
}) => {
  const { t } = useLocalization();
  const workflows = useDesignStore((state) => state.workflows);
  const currentWorkflowId = useDesignStore((state) => state.currentWorkflowId);
  const [showBosMediaModal, setShowBosMediaModal] = useState(false);
  const resolvedRoute = useMemo(() => resolveRobotPageRoute(currentPath), [currentPath]);
  const workflowsList = useMemo(() => (Array.isArray(workflows) ? workflows : []), [workflows]);
  const activeWorkflow = useMemo(
    () => workflowsList.find((workflow) => workflow._id === currentWorkflowId) ?? workflowsList[0] ?? null,
    [currentWorkflowId, workflowsList],
  );

  React.useEffect(() => {
    if (resolvedRoute !== ROBOT_PAGE_ROUTE_IDS.bosDashboard && resolvedRoute !== ROBOT_PAGE_ROUTE_IDS.bosSupervision) {
      return;
    }

    try {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        try {
          publishHydrationComponentReady({
            source: 'bos-media-button',
            workflowId: activeWorkflow?._id ?? currentWorkflowId ?? null,
          });
        } catch {
          // ignore readiness signal failures
        }
      }));
    } catch {
      // ignore readiness signal failures
    }
  }, [activeWorkflow?._id, currentWorkflowId, resolvedRoute]);

  // Navigation helper to go to workflow map (Bos Dashboard)
  const handleNavigateToWorkflow = () => {
    if (onNavigate) {
      onNavigate(RobotId.Bos, '/bos/dashboard');
    }
  };

  // Props communes pour les WorkflowPage
  const workflowProps = {
    agents,
    llmConfigs,
    onWorkflowCanvasReady,
    onDeleteNode,
    onUpdateNodeMessages,
    onUpdateNodePosition,
    onToggleNodeMinimize,
    onOpenImagePanel,
    onOpenImageModificationPanel,
    onOpenVideoPanel,
    onOpenMapsPanel,
    onOpenFullscreen,
    onAddToWorkflow,
  };

  const bosMediaHeaderAction = (
    <>
      <button
        type="button"
        onClick={() => setShowBosMediaModal(true)}
        disabled={!activeWorkflow}
        className="rounded-lg border border-yellow-400/50 bg-yellow-500 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-yellow-400 disabled:cursor-not-allowed disabled:border-gray-700 disabled:bg-gray-800 disabled:text-gray-500"
      >
        {t('bos_media_button', 'Gestion des fichiers')}
      </button>
      {showBosMediaModal ? (
        <Suspense fallback={null}>
          <LazyBosMediaModal
            isOpen={showBosMediaModal}
            workflowId={activeWorkflow?._id ?? null}
            workflowName={activeWorkflow?.name ?? null}
            onClose={() => setShowBosMediaModal(false)}
          />
        </Suspense>
      ) : null}
    </>
  );

  switch (resolvedRoute) {
    case ROBOT_PAGE_ROUTE_IDS.archi:
      return (
        <Suspense fallback={<RouteFallback />}>
          <LazyArchiPrototypingPage llmConfigs={llmConfigs} onNavigateToWorkflow={handleNavigateToWorkflow} onAddToWorkflow={onAddToWorkflow} onDeleteNodes={onDeleteNodes} />
        </Suspense>
      );
    case ROBOT_PAGE_ROUTE_IDS.bosDashboard:
      return (
        <WorkflowPage
          robotName={t('page_dashboard_title')}
          description={t('page_dashboard_description')}
          headerActions={bosMediaHeaderAction}
          {...workflowProps}
        />
      );
    case ROBOT_PAGE_ROUTE_IDS.bosSupervision:
      return (
        <WorkflowPage
          robotName={t('page_bos_supervision_title')}
          description={t('page_bos_supervision_description')}
          headerActions={bosMediaHeaderAction}
          {...workflowProps}
        />
      );
    case ROBOT_PAGE_ROUTE_IDS.bosWorkflowManagement:
      return (
        <Suspense fallback={<RouteFallback />}>
          <div className="h-full">
            <LazyBosWorkflowManagementPage />
          </div>
        </Suspense>
      );
    case ROBOT_PAGE_ROUTE_IDS.comDatabases:
      return (
        <Suspense fallback={<RouteFallback />}>
          <LazyComDatabasesPage />
        </Suspense>
      );
    case ROBOT_PAGE_ROUTE_IDS.comApi:
      return (
        <Suspense fallback={<RouteFallback />}>
          <LazyComApiPage />
        </Suspense>
      );
    case ROBOT_PAGE_ROUTE_IDS.philFunctions:
      return (
        <Suspense fallback={<RouteFallback />}>
          <LazyPhilFunctionsPage />
        </Suspense>
      );
    case ROBOT_PAGE_ROUTE_IDS.philData:
      return (
        <Suspense fallback={<RouteFallback />}>
          <LazyPhilDataPage
            onNavigateToWorkflow={handleNavigateToWorkflow}
          />
        </Suspense>
      );
    case ROBOT_PAGE_ROUTE_IDS.timEvents:
      return (
        <Suspense fallback={<RouteFallback />}>
          <LazyTimEventsPage
            onNavigateToWorkflow={handleNavigateToWorkflow}
          />
        </Suspense>
      );
    case ROBOT_PAGE_ROUTE_IDS.fallback:
    default:
      return (
        <PlaceholderPage
          robotName={t('page_orchestrator_title')}
          description={t('page_orchestrator_description')}
        />
      );
  }
};

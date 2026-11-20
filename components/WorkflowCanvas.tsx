import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef, memo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  ConnectionMode,
  Node,
  NodeTypes,
  Viewport,
  useReactFlow,
  ReactFlowProvider,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { V2AgentNode } from './V2AgentNode';
import { OptimizedWorkflowBackground } from './OptimizedWorkflowBackground';
import { useDayNightTheme } from '../hooks/useDayNightTheme';
import { WorkflowCanvasProvider } from '../contexts/WorkflowCanvasContext';
import { PrototypeEditConfirmationModal } from './modals/PrototypeEditConfirmationModal';
import { AgentFormModal } from './modals/AgentFormModal';
import { SavePrototypeButton } from './SavePrototypeButton';
import { AutoSaveIndicator } from './AutoSaveIndicator';
import { useAutoSave } from '../hooks/useAutoSave';
import { Agent, AgentDraft, WorkflowNode, LLMConfig, AgentInstance, NodePositionUpdateOptions, RobotId, ChatMessage, MapsPanelPreloadedResults } from '../types';
import { useDesignStore } from '../stores/useDesignStore';
import { useAuth } from '../contexts/AuthContext';
import { isValidWorkflowConnection } from './workflow/connectionContracts';
import { registerReactFlowWarningProbe } from '../utils/reactFlowWarningDiagnostics';
import { findCollisionFreeWorkflowNodePosition, type WorkflowNodeCollisionRect } from '../utils/workflowNodePlacement';
import { projectWorkflowNodesToReactFlowNodes, type CanvasWorkflowNode } from '../services/workflowNodeReactFlowAdapter';
import { publishHydrationComponentReady, recordHydrationLayoutMark } from '../utils/hydrationComponentReadiness';

interface WorkflowCanvasProps {
  nodes?: WorkflowNode[];
  llmConfigs?: LLMConfig[];
  onCanvasReady?: () => void;
  onDeleteNode?: (nodeId: string) => void;
  onUpdateNodeMessages?: (nodeId: string, messages: ChatMessage[]) => void;
  onUpdateNodePosition?: (nodeId: string, position: { x: number; y: number }, options?: NodePositionUpdateOptions) => void;
  onToggleNodeMinimize?: (nodeId: string) => void;
  onOpenImagePanel?: (nodeId: string, agent: Agent, agentInstance: AgentInstance) => void;
  onOpenImageModificationPanel?: (nodeId: string, sourceImage: string, agent?: Agent, agentInstance?: AgentInstance, mimeType?: string) => void;
  onOpenVideoPanel?: (nodeId: string, agent: Agent, agentInstance: AgentInstance) => void;
  onOpenMapsPanel?: (nodeId: string, preloadedResults?: MapsPanelPreloadedResults) => void;
  onOpenFullscreen?: (imageBase64: string, mimeType: string) => void;
  agents?: Agent[];
  onAddToWorkflow?: (agent: Agent) => void;
  onUpdateWorkflowNode?: (nodeId: string, updates: Partial<WorkflowNode>) => void;
  onRemoveFromWorkflow?: (nodeId: string) => void;
  onNavigate?: (robotId: RobotId, path: string) => void; // Pour navigation vers prototypage
  // ⭐ ÉTAPE 2: Persistence props
  workflowId?: string;
  workflowName?: string;
  onSaveComplete?: (success: boolean) => void;
}

// nodeTypes défini GLOBALEMENT pour éviter les re-créations (React Flow best practice)
// Ne JAMAIS définir ceci dans le composant ou utiliser useMemo
const NODE_TYPES: NodeTypes = Object.freeze({
  customAgent: V2AgentNode,
});

const EDGE_TYPES = Object.freeze({});
const REACT_FLOW_STYLE = Object.freeze({ background: 'transparent' });
const DEFAULT_VIEWPORT = Object.freeze({ x: 0, y: 0, zoom: 0.7 });
const PRO_OPTIONS = Object.freeze({ hideAttribution: true });
const createMutableArray = <T,>(): T[] => Array.from<T>({ length: 0 });
const EMPTY_WORKFLOW_NODES = createMutableArray<WorkflowNode>();
const EMPTY_LLM_CONFIGS = createMutableArray<LLMConfig>();
const EMPTY_AGENTS = createMutableArray<Agent>();
let workflowCanvasMountSequence = 0;
// UI-only: last user/fit viewport per workflow, restored when the canvas remounts after a route change.
const lastViewportByWorkflow = new Map<string, Viewport>();
type ReactFlowNodeWithMeasuredSize = Node & { measured?: { height?: number; width?: number } };
type ReactFlowNodeLookup = {
  getNode?: (nodeId: string) => ReactFlowNodeWithMeasuredSize | undefined;
  getNodes?: () => ReactFlowNodeWithMeasuredSize[];
};

const normalizeOptionalDimension = (value: number | null | undefined): number | undefined => (
  typeof value === 'number' ? value : undefined
);

const buildCollisionRect = (params: {
  nodeId: string;
  instanceId?: string;
  position: { x: number; y: number };
  workflowId: string | null;
  width?: number;
  height?: number;
}): WorkflowNodeCollisionRect => ({
  nodeId: params.nodeId,
  instanceId: params.instanceId,
  position: params.position,
  workflowId: params.workflowId,
  width: normalizeOptionalDimension(params.width),
  height: normalizeOptionalDimension(params.height),
});

// Composant interne avec accès à useReactFlow
const WorkflowCanvasInner = memo(function WorkflowCanvasInner(props: WorkflowCanvasProps) {
  const {
    nodes = EMPTY_WORKFLOW_NODES,
    llmConfigs = EMPTY_LLM_CONFIGS,
    onCanvasReady,
    onDeleteNode,
    onUpdateNodeMessages,
    onUpdateNodePosition,
    onToggleNodeMinimize,
    onOpenImagePanel,
    onOpenImageModificationPanel,
    onOpenVideoPanel,
    onOpenMapsPanel,
    onOpenFullscreen,
    agents = EMPTY_AGENTS,
    onAddToWorkflow,
    onNavigate,
    // ⭐ ÉTAPE 2: Persistence props
    workflowId: workflowIdProp,
    workflowName,
    onSaveComplete
  } = props;

  const { isAuthenticated } = useAuth();
  const workflowCanvasMountIdRef = useRef(0);
  const canvasReadySignatureRef = useRef<string | null>(null);
  const canvasRootRef = useRef<HTMLDivElement | null>(null);
  const layoutStabilityTimerRef = useRef<number | null>(null);
  const layoutShiftCountRef = useRef(0);
  const initialViewportSettledRef = useRef(false);
  const viewportCenterRequestRef = useRef(false);
  const viewportFitTimerRef = useRef<number | null>(null);
  const isCanvasMountedRef = useRef(true);
  const workflowFitSignatureRef = useRef<string | null>(null);
  const pendingFitSignatureRef = useRef<string | null>(null);
  const [layoutStabilityRevision, setLayoutStabilityRevision] = useState(0);
  const [initialViewportSettledRevision, setInitialViewportSettledRevision] = useState(0);
  if (workflowCanvasMountIdRef.current === 0) {
    workflowCanvasMountIdRef.current = ++workflowCanvasMountSequence;
  }

  // ⭐ V2: the design store is the canonical workflow identity source.
  const designCurrentWorkflowId = useDesignStore((state) => state.currentWorkflowId);
  const viewportFitHistory = useDesignStore((state) => state.viewportFitHistory);
  const markWorkflowViewportFit = useDesignStore((state) => state.markWorkflowViewportFit);
  const clearWorkflowViewportFit = useDesignStore((state) => state.clearWorkflowViewportFit);
  const workflowId = designCurrentWorkflowId || workflowIdProp || 'default-workflow';
  const [mountViewport] = useState<Viewport>(() => lastViewportByWorkflow.get(workflowId) ?? DEFAULT_VIEWPORT);
  const workflowIdRef = useRef(workflowId);
  workflowIdRef.current = workflowId;

  // Hook de thème jour/nuit
  const theme = useDayNightTheme();

  // Hook React Flow pour fitView
  const reactFlowInstance = useReactFlow();
  const reactFlowLookup = reactFlowInstance as typeof reactFlowInstance & ReactFlowNodeLookup;

  // ⭐ Lasso du mode "clic" : React Flow 11.11.4 (connectOnClick=true par défaut) ne rend
  // AUCUNE ligne de connexion en mode clic (ConnectionLineWrapper ne lit que connectionNodeId,
  // posé uniquement pendant le drag). On trace donc nous-mêmes le fil entre la poignée cliquée
  // et le curseur, en coordonnées relatives au conteneur du canvas.
  // Annulation : onClickConnectEnd (2e clic sur une poignée) ou mousedown hors poignée
  // (clic ailleurs -> on annule via un clic synthétique sur la poignée de départ, que le
  // onClick de RF 11.11.4 traite comme une annulation : isValidHandle(same handle) = false).
  const clickLassoStartElRef = useRef<HTMLElement | null>(null);
  const [clickLasso, setClickLasso] = useState<{
    x1: number; y1: number; x2: number; y2: number; handleType: 'source' | 'target';
  } | null>(null);

  const handleClickConnectStart = useCallback((event: any, handle: any) => {
    const handleEl = event.target as HTMLElement | null;
    const container = canvasRootRef.current;
    if (!handleEl || !container) return;
    clickLassoStartElRef.current = handleEl;
    const hr = handleEl.getBoundingClientRect();
    const cr = container.getBoundingClientRect();
    const x1 = hr.left + hr.width / 2 - cr.left;
    const y1 = hr.top + hr.height / 2 - cr.top;
    setClickLasso({ x1, y1, x2: x1, y2: y1, handleType: handle?.handleType === 'target' ? 'target' : 'source' });
  }, []);

  const handleClickConnectEnd = useCallback(() => {
    clickLassoStartElRef.current = null;
    setClickLasso(null);
  }, []);

  const clickLassoActive = clickLasso !== null;
  useEffect(() => {
    if (!clickLassoActive) return;
    const onMouseMove = (ev: MouseEvent) => {
      const container = canvasRootRef.current;
      if (!container) return;
      const cr = container.getBoundingClientRect();
      setClickLasso((prev) => (prev ? { ...prev, x2: ev.clientX - cr.left, y2: ev.clientY - cr.top } : prev));
    };
    const onMouseDown = (ev: MouseEvent) => {
      // Clic ailleurs que sur une poignée -> annule la procédure de lien :
      // le lasso disparaît, la boule s'éteint (onClickConnectEnd -> plus de .connecting).
      const target = ev.target as HTMLElement | null;
      if (!target?.closest('.react-flow__handle')) {
        const startEl = clickLassoStartElRef.current;
        if (startEl && startEl.isConnected) {
          // clic synthétique sur la poignée de départ : le onClick de RF voit
          // connectionClickStartHandle set + même handle -> invalide -> annulation propre
          startEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        }
        clickLassoStartElRef.current = null;
        setClickLasso(null);
      }
    };
    window.addEventListener('mousemove', onMouseMove);
    // ⭐ capture=true : le mousedown du pane est stoppé en propagation par d3-zoom/RF
    // avant d'atteindre window en phase bubble ; en capture on le voit toujours.
    window.addEventListener('mousedown', onMouseDown, true);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDown, true);
    };
  }, [clickLassoActive]);

  // ISOLATION COMPLÈTE: un seul useState pour éviter les conflits React Flow
  const [internalState, setInternalState] = useState({
    showAgentForm: false,
    showPrototypeConfirm: false,
    selectedAgentForEdit: null as string | null,
    minimapReady: false, // Ajout pour contrôler le rendu de la MiniMap
  });

  const markInitialViewportSettled = useCallback((note: string) => {
    if (!isCanvasMountedRef.current) {
      return;
    }

    initialViewportSettledRef.current = true;
    setInitialViewportSettledRevision((currentRevision) => currentRevision + 1);
    recordHydrationLayoutMark({
      source: 'workflow-canvas:viewport-settled',
      workflowId,
      note,
      count: layoutShiftCountRef.current,
      width: canvasRootRef.current?.clientWidth,
      height: canvasRootRef.current?.clientHeight,
    });
  }, [workflowId]);

  const requestInitialViewportFit = useCallback(() => {
    if (!isCanvasMountedRef.current || !reactFlowInstance || viewportCenterRequestRef.current || initialViewportSettledRef.current) {
      return;
    }

    viewportCenterRequestRef.current = true;

    const applyViewportFit = (attempt = 0) => {
      if (!isCanvasMountedRef.current) {
        return;
      }

      if (viewportFitTimerRef.current !== null) {
        window.clearTimeout(viewportFitTimerRef.current);
        viewportFitTimerRef.current = null;
      }

      const fallbackRoot = typeof document !== 'undefined'
        ? document.querySelector('[data-testid="workflow-canvas-root"]') as HTMLDivElement | null
        : null;
      const rootEl = (canvasRootRef.current && (canvasRootRef.current.clientWidth > 0 || canvasRootRef.current.clientHeight > 0))
        ? canvasRootRef.current
        : fallbackRoot ?? canvasRootRef.current;

      if (!reactFlowInstance) {
        if (attempt < 10) {
          viewportFitTimerRef.current = window.setTimeout(() => applyViewportFit(attempt + 1), 120);
        }
        return;
      }

      if (rootEl && (rootEl.clientWidth <= 0 || rootEl.clientHeight <= 0)) {
        if (attempt < 10) {
          viewportFitTimerRef.current = window.setTimeout(() => applyViewportFit(attempt + 1), 120);
        } else {
          markInitialViewportSettled('initial-hidden-canvas');
        }
        return;
      }

      const candidateNodes = stableRefs.current.actualNodes.length > 0
        ? stableRefs.current.actualNodes
        : (typeof reactFlowInstance.getNodes === 'function' ? reactFlowInstance.getNodes() : stableRefs.current.reactFlowNodes);
      if (!candidateNodes || candidateNodes.length === 0) {
        if (attempt < 10) {
          viewportFitTimerRef.current = window.setTimeout(() => applyViewportFit(attempt + 1), 120);
          return;
        }
        markInitialViewportSettled('initial-empty-canvas');
        return;
      }

      let bounds: { x: number; y: number; width: number; height: number } | null = null;
      if (typeof reactFlowInstance.getNodesBounds === 'function') {
        bounds = reactFlowInstance.getNodesBounds(candidateNodes as any);
      } else {
        const reduced = candidateNodes.reduce((acc, node) => {
          const nodePosition = 'position' in node && node.position ? node.position : { x: 0, y: 0 };
          const measured = 'measured' in node ? node.measured as { width?: number; height?: number } | undefined : undefined;
          const nodeWidth = 'width' in node && typeof node.width === 'number' ? node.width : measured?.width ?? 220;
          const nodeHeight = 'height' in node && typeof node.height === 'number' ? node.height : measured?.height ?? 140;
          const nodeX = nodePosition?.x ?? 0;
          const nodeY = nodePosition?.y ?? 0;
          const minX = Math.min(acc.minX, nodeX);
          const minY = Math.min(acc.minY, nodeY);
          const maxX = Math.max(acc.maxX, nodeX + nodeWidth);
          const maxY = Math.max(acc.maxY, nodeY + nodeHeight);
          return { minX, minY, maxX, maxY };
        }, {
          minX: Number.POSITIVE_INFINITY,
          minY: Number.POSITIVE_INFINITY,
          maxX: Number.NEGATIVE_INFINITY,
          maxY: Number.NEGATIVE_INFINITY,
        });

        if (!Number.isFinite(reduced.minX) || !Number.isFinite(reduced.minY) || !Number.isFinite(reduced.maxX) || !Number.isFinite(reduced.maxY)) {
          if (attempt < 10) {
            viewportFitTimerRef.current = window.setTimeout(() => applyViewportFit(attempt + 1), 120);
            return;
          }
          markInitialViewportSettled('initial-empty-canvas');
          return;
        }

        bounds = {
          x: reduced.minX,
          y: reduced.minY,
          width: Math.max(reduced.maxX - reduced.minX, 1),
          height: Math.max(reduced.maxY - reduced.minY, 1),
        };
      }

      if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) {
        if (attempt < 10) {
          viewportFitTimerRef.current = window.setTimeout(() => applyViewportFit(attempt + 1), 120);
          return;
        }
        markInitialViewportSettled('initial-empty-canvas');
        return;
      }

      const groupCenterX = bounds.x + bounds.width / 2;
      const groupCenterY = bounds.y + bounds.height / 2;

      if (typeof reactFlowInstance.setViewport === 'function') {
        reactFlowInstance.setViewport(DEFAULT_VIEWPORT, { duration: 0 });
      }

      if (typeof reactFlowInstance.setCenter === 'function') {
        reactFlowInstance.setCenter(groupCenterX, groupCenterY, {
          duration: 0,
          zoom: DEFAULT_VIEWPORT.zoom,
        });
      }

      const fitted = typeof reactFlowInstance.getViewport === 'function' ? reactFlowInstance.getViewport() : null;
      // The pane may not be initialised yet: setCenter is then a silent no-op and getViewport returns the store default.
      const fitApplied = !fitted || (Number.isFinite(fitted.x) && Number.isFinite(fitted.y) && Math.abs(fitted.zoom - DEFAULT_VIEWPORT.zoom) < 0.01);

      if (!fitApplied) {
        if (attempt < 10) {
          viewportFitTimerRef.current = window.setTimeout(() => applyViewportFit(attempt + 1), 120);
          return;
        }
        markInitialViewportSettled('initial-fit-not-applied');
        return;
      }

      if (fitted) {
        lastViewportByWorkflow.set(workflowIdRef.current, fitted);
      }

      if (pendingFitSignatureRef.current) {
        markWorkflowViewportFit(workflowIdRef.current, pendingFitSignatureRef.current);
      }

      markInitialViewportSettled('initial-fit-view');
    };

    viewportFitTimerRef.current = window.setTimeout(() => applyViewportFit(0), 120);
  }, [markInitialViewportSettled, markWorkflowViewportFit, reactFlowInstance]);

  // useRef pour TOUT stocker sans déclencher de re-render
  const stableRefs = useRef({
    callbacks: {
      onDeleteNode: onDeleteNode || (() => { }),
      onUpdateNodeMessages: onUpdateNodeMessages || (() => { }),
      onUpdateNodePosition: onUpdateNodePosition || (() => { }),
      onToggleNodeMinimize: onToggleNodeMinimize || (() => { }),
      onOpenImagePanel: onOpenImagePanel || (() => { }),
      onOpenImageModificationPanel: onOpenImageModificationPanel || (() => { }),
      onOpenFullscreen: onOpenFullscreen || (() => { })
    },
    actualNodes: [] as CanvasWorkflowNode[],
    agents: [] as Agent[],
    reactFlowNodes: [] as Node[]
  });

  // Hooks React Flow - avec gestion d'erreur pour éviter les crashes
  const [reactFlowNodes, setReactFlowNodes, onNodesChangeInternal] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const reactFlowContractRef = useRef({
    nodeTypes: NODE_TYPES,
    edgeTypes: EDGE_TYPES,
    style: REACT_FLOW_STYLE,
    defaultViewport: mountViewport,
    proOptions: PRO_OPTIONS,
  });
  const reactFlowWarningSnapshotRef = useRef({
    mountId: workflowCanvasMountIdRef.current,
    workflowId: 'uninitialized',
    renderCount: 0,
    actualNodeCount: 0,
    nodeCount: 0,
    edgeCount: 0,
    nodeTypesStable: true,
    edgeTypesStable: true,
    styleStable: true,
    defaultViewportStable: true,
    proOptionsStable: true,
  });

  const isCanvasDomReady = useCallback(() => {
    const rootEl = canvasRootRef.current;
    if (!rootEl) {
      return false;
    }

    if (reactFlowNodes.length === 0) {
      return rootEl.clientWidth > 0 && rootEl.clientHeight > 0;
    }

    const nodeShells = Array.from(rootEl.querySelectorAll('[data-arc-agent-node="shell"]')) as HTMLElement[];
    const nodeControls = Array.from(rootEl.querySelectorAll('[data-arc-agent-node="header-controls"]')) as HTMLElement[];

    if (nodeShells.length !== reactFlowNodes.length || nodeControls.length !== reactFlowNodes.length) {
      return false;
    }

    return nodeShells.every((nodeElement) => nodeElement.offsetWidth > 0 && nodeElement.offsetHeight > 0);
  }, [reactFlowNodes.length]);

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') {
      return undefined;
    }

    return registerReactFlowWarningProbe(() => reactFlowWarningSnapshotRef.current);
  }, []);

  // Dernière position connue par nœud, alimentée à chaque changement 'position' appliqué via
  // onNodesChange. En mode contrôlé, le `node` passé à onNodeDragStop est lu dans le store
  // interne de React Flow, qui n'est resynchronisé qu'au commit du rendu suivant : lors d'un
  // second drag immédiat après un drop résolu par collision, ce node.position peut être en
  // retard d'un rendu. Cette ref est donc la source de vérité pour le point de lâcher.
  const lastNodePositionChangesRef = useRef(new Map<string, { x: number; y: number }>());

  // Wrapper sécurisé pour onNodesChange avec logging d'erreurs
  const onNodesChange = useCallback((changes: any) => {
    try {
      if (Array.isArray(changes)) {
        for (const change of changes) {
          if (change?.type === 'position' && change.position
            && Number.isFinite(change.position.x) && Number.isFinite(change.position.y)) {
            lastNodePositionChangesRef.current.set(change.id, { x: change.position.x, y: change.position.y });
          } else if (change?.type === 'remove' && change.id) {
            lastNodePositionChangesRef.current.delete(change.id);
          }
        }
      }
      onNodesChangeInternal(changes);
    } catch (error) {
      console.error('[WorkflowCanvas] Error in onNodesChange:', error);
      // Ne pas propager l'erreur pour éviter de casser l'UI
    }
  }, [onNodesChangeInternal]);

  // ⭐ FIX SOLID: Utiliser la source unique de vérité pour les nodes.
  // Le chemin actif du runtime lit désormais le store, avec `nodes` comme compatibilité explicite.
  const storeNodes = useDesignStore((state) => state.nodes);
  
  // Calculer actualNodes de manière stable
  const actualNodes = useMemo<CanvasWorkflowNode[]>(() => {
    if (storeNodes && storeNodes.length > 0) {
      return storeNodes;
    }
    if (nodes && nodes.length > 0) {
      return nodes;
    }

    return [];
  }, [storeNodes, nodes]);

  reactFlowWarningSnapshotRef.current = {
    mountId: workflowCanvasMountIdRef.current,
    workflowId,
    renderCount: reactFlowWarningSnapshotRef.current.renderCount + 1,
    actualNodeCount: actualNodes.length,
    nodeCount: reactFlowNodes.length,
    edgeCount: edges.length,
    nodeTypesStable: reactFlowContractRef.current.nodeTypes === NODE_TYPES,
    edgeTypesStable: reactFlowContractRef.current.edgeTypes === EDGE_TYPES,
    styleStable: reactFlowContractRef.current.style === REACT_FLOW_STYLE,
    defaultViewportStable: reactFlowContractRef.current.defaultViewport === mountViewport,
    proOptionsStable: reactFlowContractRef.current.proOptions === PRO_OPTIONS,
  };

  stableRefs.current.actualNodes = actualNodes;
  stableRefs.current.reactFlowNodes = reactFlowNodes;

  useEffect(() => {
    // StrictMode re-runs effects in order: the unmount cleanup flag must be re-armed before the fit is requested.
    isCanvasMountedRef.current = true;
    const signature = `${workflowId}:${actualNodes.map((node) => node.id).join('|')}`;
    if (actualNodes.length === 0) {
      workflowFitSignatureRef.current = null;
      clearWorkflowViewportFit(workflowId);
      return undefined;
    }

    const persistedSignature = viewportFitHistory[workflowId];
    if (persistedSignature === signature || workflowFitSignatureRef.current === signature) {
      return undefined;
    }

    workflowFitSignatureRef.current = signature;
    pendingFitSignatureRef.current = signature;
    initialViewportSettledRef.current = false;
    viewportCenterRequestRef.current = false;
    requestInitialViewportFit();

    return undefined;
  }, [actualNodes, clearWorkflowViewportFit, requestInitialViewportFit, viewportFitHistory, workflowId]);

  const resolveDroppedNodePosition = useCallback((
    nodeId: string,
    desiredPosition: { x: number; y: number },
    draggedNodeSize?: { width?: number; height?: number },
  ) => {
    const designState = useDesignStore.getState();
    const movedNode = designState.nodes.find((candidate) => candidate.id === nodeId);
    const instanceId = movedNode?.data?.agentInstance?.id;
    const nodeWorkflowId = movedNode?.data?.workflowId
      || movedNode?.data?.agentInstance?.workflowId
      || workflowId;
    const liveNodes: ReactFlowNodeWithMeasuredSize[] = typeof (reactFlowInstance as typeof reactFlowInstance & { getNodes?: () => ReactFlowNodeWithMeasuredSize[] }).getNodes === 'function'
      ? (reactFlowInstance as typeof reactFlowInstance & { getNodes: () => ReactFlowNodeWithMeasuredSize[] }).getNodes()
      : stableRefs.current.reactFlowNodes as ReactFlowNodeWithMeasuredSize[];
    const getNodeWidth = (candidate?: ReactFlowNodeWithMeasuredSize) => normalizeOptionalDimension(candidate?.measured?.width ?? candidate?.width);
    const getNodeHeight = (candidate?: ReactFlowNodeWithMeasuredSize) => normalizeOptionalDimension(candidate?.measured?.height ?? candidate?.height);
    const movedLiveNode = liveNodes.find((candidate) => candidate.id === nodeId);
    const occupiedNodeRects: WorkflowNodeCollisionRect[] = [];
    for (const candidate of liveNodes) {
      if (!Number.isFinite(candidate.position?.x) || !Number.isFinite(candidate.position?.y)) {
        continue;
      }

      const width = getNodeWidth(candidate);
      const height = getNodeHeight(candidate);

      occupiedNodeRects.push(buildCollisionRect({
        nodeId: candidate.id,
        instanceId: candidate.data?.agentInstance?.id,
        position: candidate.position,
        workflowId: candidate.data?.workflowId ?? candidate.data?.agentInstance?.workflowId ?? nodeWorkflowId ?? null,
        width,
        height,
      }));
    }

    const subjectWidth = normalizeOptionalDimension(draggedNodeSize?.width) ?? getNodeWidth(movedLiveNode);
    const subjectHeight = normalizeOptionalDimension(draggedNodeSize?.height) ?? getNodeHeight(movedLiveNode);

    const gestureVector = movedNode?.position && desiredPosition
      ? { x: desiredPosition.x - movedNode.position.x, y: desiredPosition.y - movedNode.position.y }
      : undefined;

    return findCollisionFreeWorkflowNodePosition({
      nodeId,
      instanceId,
      currentPosition: movedNode?.position,
      desiredPosition,
      workflowId: nodeWorkflowId,
      nodes: designState.nodes,
      agentInstances: designState.agentInstances,
      occupiedNodeRects,
      subjectSize: {
        width: subjectWidth,
        height: subjectHeight,
      },
      gestureVector,
    });
  }, [reactFlowInstance, workflowId]);

  const onNodeDragStop = useCallback((_: unknown, node: ReactFlowNodeWithMeasuredSize) => {
    try {
      // En mode contrôlé, le `node` de l'événement provient du store interne de React Flow,
      // resynchronisé seulement au commit du rendu suivant : lors d'un second drag immédiat
      // après un drop résolu par collision, node.position peut être la position d'avant le
      // drag, ce qui ferait reculer le nœud au lieu de le laisser à son point de lâcher.
      // La dernière position appliquée via onNodesChange est la source de vérité.
      const stateNode = stableRefs.current.reactFlowNodes.find((candidate) => candidate.id === node.id) as ReactFlowNodeWithMeasuredSize | undefined;
      const droppedPosition = lastNodePositionChangesRef.current.get(node.id)
        ?? (stateNode && Number.isFinite(stateNode.position?.x) && Number.isFinite(stateNode.position?.y) ? stateNode.position : undefined)
        ?? node.position;

      // measured peut être périmé après un changement de taille (ex. minimize) :
      // la taille DOM réelle au lâcher est la source de vérité pour la résolution de collision.
      const nodeElement = typeof document !== 'undefined'
        ? document.querySelector(`[data-id="${node.id}"]`) as HTMLElement | null
        : null;
      const liveWidth = normalizeOptionalDimension(nodeElement?.offsetWidth);
      const liveHeight = normalizeOptionalDimension(nodeElement?.offsetHeight);
      const resolvedPosition = resolveDroppedNodePosition(node.id, droppedPosition, {
        width: liveWidth ?? normalizeOptionalDimension(node.measured?.width ?? node.width),
        height: liveHeight ?? normalizeOptionalDimension(node.measured?.height ?? node.height),
      });
      lastNodePositionChangesRef.current.set(node.id, resolvedPosition);

      setReactFlowNodes((currentNodes) => currentNodes.map((currentNode) => {
        if (currentNode.id !== node.id) {
          return currentNode;
        }

        if (currentNode.position.x === resolvedPosition.x && currentNode.position.y === resolvedPosition.y) {
          return currentNode;
        }

        return {
          ...currentNode,
          position: resolvedPosition,
        };
      }));

      stableRefs.current.callbacks.onUpdateNodePosition(node.id, resolvedPosition, { persist: true });
    } catch (error) {
      console.error('[WorkflowCanvas] Error in onNodeDragStop:', error);
    }
  }, [resolveDroppedNodePosition, setReactFlowNodes]);

  // ⭐ PLAN_DE_PERSISTENCE: Hook de sauvegarde automatique
  const autoSave = useAutoSave({
    workflowId,
    workflowName,
    canvasState: reactFlowInstance ? {
      zoom: reactFlowInstance.getZoom(),
      panX: reactFlowInstance.getViewport().x,
      panY: reactFlowInstance.getViewport().y
    } : undefined,
    onSaveComplete
  });

  // Mettre à jour les références SANS déclencher de re-render
  stableRefs.current.callbacks = {
    onDeleteNode: onDeleteNode || (() => { }),
    onUpdateNodeMessages: onUpdateNodeMessages || (() => { }),
    onUpdateNodePosition: onUpdateNodePosition || (() => { }),
    // Wrapper: when toggle minimize/restore, re-evaluate collisions once the DOM node size has
    // settled (CSS transition) — never write `measured` from a mid-transition offsetWidth.
    // Important: moves caused by restore are applied locally (no persist) to avoid accidental DB writes for UI-only actions.
    onToggleNodeMinimize: (nodeId: string) => {
      try {
        // Call upstream handler (App) to toggle runtime state
        (onToggleNodeMinimize || (() => {}))(nodeId);

        const applyRestoreOverlapCorrection = (measuredWidth?: number, measuredHeight?: number) => {
          try {
            const designState = useDesignStore.getState();
            const movedNode = designState.nodes.find((candidate) => candidate.id === nodeId);

            const liveNode = typeof reactFlowLookup.getNode === 'function'
              ? reactFlowLookup.getNode(nodeId)
              : stableRefs.current.reactFlowNodes.find((n) => n.id === nodeId);

            const hasValidLivePosition = liveNode && Number.isFinite(liveNode.position?.x) && Number.isFinite(liveNode.position?.y);
            const designPositionValid = movedNode && Number.isFinite(movedNode.position?.x) && Number.isFinite(movedNode.position?.y);
            const desiredPosition = hasValidLivePosition ? liveNode.position : (designPositionValid ? movedNode.position : undefined);
            if (!desiredPosition) return;

            // On n'écrit plus `measured` ici : React Flow maintient width/height via son
            // propre ResizeObserver (changements 'dimensions'), et écrire un offsetWidth lu
            // pendant la transition CSS propagerait une taille périmée qui masque ensuite
            // la vraie taille (measured?.width ?? width).
            const expandedFallback = { width: 384, height: 550 };
            const liveSubjectNode = liveNode as ReactFlowNodeWithMeasuredSize | undefined;
            const liveSubjectWidth = normalizeOptionalDimension(liveSubjectNode?.measured?.width ?? liveSubjectNode?.width);
            const liveSubjectHeight = normalizeOptionalDimension(liveSubjectNode?.measured?.height ?? liveSubjectNode?.height);
            const subjectWidth = (typeof measuredWidth === 'number' && measuredWidth > 0) ? measuredWidth : (liveSubjectWidth ?? expandedFallback.width);
            const subjectHeight = (typeof measuredHeight === 'number' && measuredHeight > 0) ? measuredHeight : (liveSubjectHeight ?? expandedFallback.height);

            const liveNodes: ReactFlowNodeWithMeasuredSize[] = typeof reactFlowLookup.getNodes === 'function'
              ? reactFlowLookup.getNodes()
              : (stableRefs.current.reactFlowNodes as ReactFlowNodeWithMeasuredSize[]);

            const occupiedNodeRects: WorkflowNodeCollisionRect[] = [];
            for (const candidate of liveNodes) {
              if (!Number.isFinite(candidate.position?.x) || !Number.isFinite(candidate.position?.y)) {
                continue;
              }

              const width = normalizeOptionalDimension(candidate.measured?.width ?? candidate.width);
              const height = normalizeOptionalDimension(candidate.measured?.height ?? candidate.height);

              occupiedNodeRects.push(buildCollisionRect({
                nodeId: candidate.id,
                instanceId: candidate.data?.agentInstance?.id,
                position: candidate.position,
                workflowId: candidate.data?.workflowId ?? candidate.data?.agentInstance?.workflowId ?? workflowId ?? null,
                width,
                height,
              }));
            }

            const resolved = findCollisionFreeWorkflowNodePosition({
              nodeId,
              instanceId: movedNode?.data?.agentInstance?.id,
              currentPosition: movedNode?.position,
              desiredPosition,
              workflowId,
              nodes: designState.nodes,
              agentInstances: designState.agentInstances,
              occupiedNodeRects,
              subjectSize: { width: subjectWidth, height: subjectHeight },
              maxSearchRadius: 24,
            });

            const shouldCorrectForOverlap = Boolean(
              resolved && (resolved.x !== desiredPosition.x || resolved.y !== desiredPosition.y)
            );

            if (shouldCorrectForOverlap) {
              setReactFlowNodes((current) => current.map((n) => n.id === nodeId ? { ...n, position: resolved } : n));
              (onUpdateNodePosition || (() => {}))(nodeId, resolved, { persist: false });
            }
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn('[WorkflowCanvas] perimeter-check/restore correction failed:', err);
          }
        };

        const nodeEl = typeof document !== 'undefined' ? document.querySelector(`[data-id="${nodeId}"]`) as HTMLElement | null : null;
        // La taille du nœud évolue via une transition CSS (transition-all duration-300,
        // w-96 <-> w-64) : lire offsetWidth à ce moment donnerait une valeur transitoire.
        // On observe donc le nœud jusqu'à la fin de la transition et on ne corrige la
        // collision qu'avec la taille stabilisée (source de vérité : ResizeObserver +
        // transitionend, jamais un offsetWidth lu en pleine transition).
        if (!nodeEl || typeof window === 'undefined') {
          applyRestoreOverlapCorrection();
          return;
        }

        let finished = false;
        let correctionTimer: number | null = null;
        let fallbackTimer: number | null = null;
        let latestWidth: number | undefined;
        let latestHeight: number | undefined;

        const scheduleSettledCorrection = (width?: number, height?: number) => {
          latestWidth = width;
          latestHeight = height;
          if (correctionTimer !== null) {
            window.clearTimeout(correctionTimer);
          }
          // Debounce : la transition émet un ResizeObserver par frame, on attend que la
          // taille se stabilise avant de corriger.
          correctionTimer = window.setTimeout(() => {
            correctionTimer = null;
            if (!finished) {
              applyRestoreOverlapCorrection(latestWidth, latestHeight);
            }
          }, 120);
        };

        const resizeObserver = typeof ResizeObserver !== 'undefined'
          ? new ResizeObserver((entries) => {
            const entry = entries[entries.length - 1];
            if (!entry || finished) {
              return;
            }
            scheduleSettledCorrection(entry.contentRect.width, entry.contentRect.height);
          })
          : null;

        const finish = () => {
          if (finished) {
            return;
          }
          finished = true;
          resizeObserver?.disconnect();
          nodeEl.removeEventListener('transitionend', onTransitionEnd);
          if (correctionTimer !== null) {
            window.clearTimeout(correctionTimer);
          }
          if (fallbackTimer !== null) {
            window.clearTimeout(fallbackTimer);
          }
          const settledEl = document.querySelector(`[data-id=\"${nodeId}\"]`) as HTMLElement | null;
          applyRestoreOverlapCorrection(settledEl?.offsetWidth ?? latestWidth, settledEl?.offsetHeight ?? latestHeight);
        };

        const onTransitionEnd = (event: TransitionEvent) => {
          if (event.target !== nodeEl) {
            return;
          }
          // Laisser le ResizeObserver livrer la taille finale, puis corriger une dernière fois.
          if (typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(() => finish());
          } else {
            finish();
          }
        };

        resizeObserver?.observe(nodeEl);
        nodeEl.addEventListener('transitionend', onTransitionEnd);
        // Secours si transitionend ne se déclenche pas (transitions désactivées, onglet caché, etc.)
        fallbackTimer = window.setTimeout(finish, 600);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[WorkflowCanvas] onToggleNodeMinimize wrapper error:', err);
      }
    },
    onOpenImagePanel: onOpenImagePanel || (() => { }),
    onOpenImageModificationPanel: onOpenImageModificationPanel || (() => { }),
    onOpenFullscreen: onOpenFullscreen || (() => { })
  };

  // Ref stable pour agents (évite les dépendances cycliques)
  stableRefs.current.agents = agents;

  useLayoutEffect(() => {
    const rootEl = canvasRootRef.current;
    if (!rootEl || typeof window === 'undefined') {
      return undefined;
    }

    const scheduleStableMark = (width: number, height: number) => {
      if (layoutStabilityTimerRef.current !== null) {
        window.clearTimeout(layoutStabilityTimerRef.current);
      }

      layoutStabilityTimerRef.current = window.setTimeout(() => {
        recordHydrationLayoutMark({
          source: 'workflow-canvas:layout-stable',
          workflowId,
          width,
          height,
          count: layoutShiftCountRef.current,
        });
        setLayoutStabilityRevision((currentRevision) => currentRevision + 1);
      }, 120);
    };

    if (typeof ResizeObserver === 'undefined') {
      scheduleStableMark(rootEl.clientWidth, rootEl.clientHeight);
      return () => {
        if (layoutStabilityTimerRef.current !== null) {
          window.clearTimeout(layoutStabilityTimerRef.current);
        }
      };
    }

    let lastWidth = -1;
    let lastHeight = -1;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      if (width === lastWidth && height === lastHeight) {
        return;
      }

      lastWidth = width;
      lastHeight = height;
      layoutShiftCountRef.current += 1;
      recordHydrationLayoutMark({
        source: 'workflow-canvas:layout-change',
        workflowId,
        width,
        height,
        count: layoutShiftCountRef.current,
      });
      scheduleStableMark(width, height);
    });

    observer.observe(rootEl);
    scheduleStableMark(rootEl.clientWidth, rootEl.clientHeight);

    return () => {
      observer.disconnect();
      if (layoutStabilityTimerRef.current !== null) {
        window.clearTimeout(layoutStabilityTimerRef.current);
      }
    };
  }, [workflowId]);

  // Récupérer les instances depuis le store pour synchronisation
  const agentInstances = useDesignStore((state) => state.agentInstances);
  const getResolvedInstance = useDesignStore((state) => state.getResolvedInstance);

  // SOLUTION ANTI-BOUCLE: useEffect unique et stable pour éviter les conflits
  useLayoutEffect(() => {
    if (actualNodes && actualNodes.length > 0) {
      const newReactFlowNodes: Node[] = projectWorkflowNodesToReactFlowNodes({
        workflowNodes: actualNodes,
        workflowId,
        agents,
        agentInstances,
        resolveInstance: getResolvedInstance,
      });

      // Comparaison intelligente pour éviter les mises à jour inutiles
      setReactFlowNodes(currentNodes => {
        // Vérifier si les nodes ont réellement changé
        if (currentNodes.length !== newReactFlowNodes.length) {
          return newReactFlowNodes;
        }

        const hasChanged = newReactFlowNodes.some((newNode, index) => {
          const currentNode = currentNodes[index];
          return !currentNode ||
            currentNode.id !== newNode.id ||
            currentNode.position.x !== newNode.position.x ||
            currentNode.position.y !== newNode.position.y ||
            currentNode.data.robotId !== newNode.data.robotId ||
            currentNode.data.label !== newNode.data.label ||
            currentNode.data.workflowId !== newNode.data.workflowId ||
            currentNode.data.agent?.id !== newNode.data.agent?.id ||
            currentNode.data.agentInstance?.id !== newNode.data.agentInstance?.id ||
            currentNode.data.agentInstance?.workflowId !== newNode.data.agentInstance?.workflowId ||
            // ⭐ REMOVED: isMinimized, isMaximized checks - managed by useRuntimeStore
            // Détecter les changements dans l'instance (nom, config)
            currentNode.data.agentInstance?.name !== newNode.data.agentInstance?.name ||
            (currentNode.data.agentInstance?.configuration_json && newNode.data.agentInstance?.configuration_json &&
              JSON.stringify(currentNode.data.agentInstance.configuration_json) !== JSON.stringify(newNode.data.agentInstance.configuration_json));
        });

        return hasChanged ? newReactFlowNodes : currentNodes;
      });
    } else if (stableRefs.current.reactFlowNodes.length > 0) {
      setReactFlowNodes(currentNodes => currentNodes.length > 0 ? [] : currentNodes);
    }
  }, [actualNodes, agentInstances, agents, getResolvedInstance, reactFlowInstance, workflowId]);

  // Do not auto-pan the canvas on hydration. Existing workflow positions are authoritative;
  // any viewport adjustment should be a user-driven action or a deliberate explicit fit action.
  useEffect(() => {
    isCanvasMountedRef.current = true;
    return () => {
      isCanvasMountedRef.current = false;
      if (viewportFitTimerRef.current !== null) {
        window.clearTimeout(viewportFitTimerRef.current);
        viewportFitTimerRef.current = null;
      }
      initialViewportSettledRef.current = false;
      viewportCenterRequestRef.current = false;
      workflowFitSignatureRef.current = null;
      canvasReadySignatureRef.current = null;
    };
  }, []);

  // The canvas is overflow:hidden, so a focus or scrollIntoView elsewhere in the tree can still scroll it
  // and drag nodes, minimap and controls up together; the viewport is only ever moved through React Flow.
  useEffect(() => {
    const root = canvasRootRef.current;
    if (!root) {
      return undefined;
    }

    const lockedElements = [root, root.parentElement];
    const resetScroll = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target && (lockedElements.includes(target) || target.classList?.contains('react-flow'))
        && (target.scrollTop !== 0 || target.scrollLeft !== 0)) {
        target.scrollTop = 0;
        target.scrollLeft = 0;
      }
    };

    // Scroll events do not bubble: capture on the document to see them on every locked ancestor.
    document.addEventListener('scroll', resetScroll, true);
    return () => document.removeEventListener('scroll', resetScroll, true);
  }, []);

  useEffect(() => {
    if (reactFlowNodes.length === 0) {
      if (!initialViewportSettledRef.current && !viewportCenterRequestRef.current) {
        markInitialViewportSettled('empty-canvas');
      }
      return undefined;
    }

    if (!initialViewportSettledRef.current && !viewportCenterRequestRef.current) {
      markInitialViewportSettled('hydration-preserved-viewport');
    }

    return undefined;
  }, [markInitialViewportSettled, reactFlowNodes.length]);

  // useEffect pour initialiser la MiniMap immédiatement (pas de délai pour éviter desync)
  useEffect(() => {
    // Initialiser immédiatement pour éviter la désynchronisation
    setInternalState(prev => ({ ...prev, minimapReady: true }));
  }, []);

  // Emit hydration readiness when the floating prototyping button is present
  const floatingPrototypeSignalSentRef = useRef(false);
  useEffect(() => {
    if (!onAddToWorkflow || !onNavigate) return;
    if (floatingPrototypeSignalSentRef.current) return;
    floatingPrototypeSignalSentRef.current = true;

    try {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        try {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new Event('hydration:components:ready'));
          }
        } catch (e) {
          // ignore
        }
      }));
    } catch (e) {
      // ignore
    }
  }, [onAddToWorkflow, onNavigate]);

  useEffect(() => {
    if (!onCanvasReady) {
      return undefined;
    }

    const visualNodesAreReady = actualNodes.length === reactFlowNodes.length
      && reactFlowNodes.every((node) => Boolean(node.data?.label));
    const domNodesAreReady = isCanvasDomReady();
    const layoutIsStable = layoutStabilityRevision > 0;
    const viewportIsSettled = initialViewportSettledRef.current;

    if (!visualNodesAreReady || !domNodesAreReady || !layoutIsStable || !viewportIsSettled) {
      return undefined;
    }

    const signature = `${workflowId}:${actualNodes.map((node) => node.id).join('|')}:${reactFlowNodes.length}`;
    if (canvasReadySignatureRef.current === signature) {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(() => {
      canvasReadySignatureRef.current = signature;
      publishHydrationComponentReady({
        source: 'workflow-canvas-stable',
        workflowId,
        nodeCount: reactFlowNodes.length,
        layoutShiftCount: layoutShiftCountRef.current,
        width: canvasRootRef.current?.clientWidth,
        height: canvasRootRef.current?.clientHeight,
      });
      onCanvasReady();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [actualNodes, initialViewportSettledRevision, isCanvasDomReady, layoutStabilityRevision, onCanvasReady, reactFlowNodes, workflowId]);

  // Handlers stables avec useCallback
  const onConnect = useCallback((connection: Connection) => {
    if (!isValidWorkflowConnection(connection)) {
      return;
    }

    setEdges((eds) => addEdge(connection, eds));
  }, [setEdges]);

  // Handler pour libérer le focus quand on clique sur le canvas
  const handlePaneClick = useCallback((event: any) => {
    // Retirer le focus de tout élément actif (textarea, input, etc.)
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    // Forcer le focus sur le pane React Flow pour restaurer le curseur
    const pane = event.target.closest('.react-flow__pane');
    if (pane) {
      pane.focus({ preventScroll: true });
    }
    // Désélectionner tous les nodes en cliquant sur le canvas vide
    setReactFlowNodes(nodes => nodes.map(node => ({ ...node, selected: false })));
  }, [setReactFlowNodes]);

  const handleEditPrototype = useCallback((nodeId: string) => {
    setInternalState(prev => ({
      ...prev,
      selectedAgentForEdit: nodeId,
      showPrototypeConfirm: true
    }));
  }, []);

  const handleConfirmPrototypeEdit = useCallback(() => {
    const { selectedAgentForEdit } = internalState;
    if (selectedAgentForEdit) {
      const currentActualNodes = stableRefs.current.actualNodes;
      const currentAgents = stableRefs.current.agents;
      const workflowNode = currentActualNodes.find(wf => wf && wf.id === selectedAgentForEdit);
      if (workflowNode) {
        const prototypeId = 'data' in workflowNode
          ? workflowNode.data.agent?.id ?? workflowNode.data.agentInstance?.prototypeId
          : workflowNode.agent?.id;
        const agent = prototypeId && Array.isArray(currentAgents)
          ? currentAgents.find(a => a && a.id === prototypeId)
          : null;
        if (agent) {
          setInternalState(prev => ({
            ...prev,
            showAgentForm: true,
            showPrototypeConfirm: false,
            selectedAgentForEdit: null
          }));
        }
      }
    }
  }, [internalState]);

  const handleCancelPrototypeEdit = useCallback(() => {
    setInternalState(prev => ({
      ...prev,
      showPrototypeConfirm: false,
      selectedAgentForEdit: null
    }));
  }, []);

  // Valeur du contexte - stable et mémorisée
  const contextValue = useMemo(() => ({
      onEditPrototype: handleEditPrototype,
      navigationHandler: onNavigate,
      onDeleteNode,
      // Expose the stable wrapper so consumers call the perimeter-check wrapper
      onToggleNodeMinimize: (nodeId: string) => stableRefs.current.callbacks.onToggleNodeMinimize(nodeId),
      onUpdateNodePosition,
      onOpenImagePanel,
      onOpenImageModificationPanel,
      onOpenVideoPanel,
      onOpenMapsPanel,
      onOpenFullscreen,
    }), [handleEditPrototype, onNavigate, onDeleteNode, onToggleNodeMinimize, onUpdateNodePosition, onOpenImagePanel, onOpenImageModificationPanel, onOpenVideoPanel, onOpenMapsPanel, onOpenFullscreen]);

  // Note: test helpers removed post-QA to reduce dev-only surface.

  const effectiveWorkflowId = workflowId === 'default-workflow' && isAuthenticated ? undefined : workflowId;

  return (
    <WorkflowCanvasProvider value={contextValue}>
      <div ref={canvasRootRef} className="h-full w-full relative overflow-hidden">
        {/* Background optimisé avec thème jour/nuit */}
        <OptimizedWorkflowBackground />

        <ReactFlow
          nodes={reactFlowNodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onNodeDragStop={onNodeDragStop}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          isValidConnection={isValidWorkflowConnection}
          onPaneClick={handlePaneClick}
          onClickConnectStart={handleClickConnectStart}
          onClickConnectEnd={handleClickConnectEnd}
          connectionMode={ConnectionMode.Strict}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          style={REACT_FLOW_STYLE}
          defaultViewport={mountViewport}
          onMoveEnd={(_, viewport) => lastViewportByWorkflow.set(workflowIdRef.current, viewport)}
          proOptions={PRO_OPTIONS}
          nodesDraggable={true}
          nodesConnectable={true}
          elementsSelectable={false}
        >
          {/* Controls - Harmonisé avec MiniMap (même border et border-radius) */}
          <Controls
            position="bottom-right"
            showZoom={true}
            showFitView={true}
            showInteractive={true}
            className="workflow-controls-fixed"
            style={{
              background: theme.backgroundGradient,
              border: `2px solid ${theme.particleColors[0]}`,
              borderRadius: '8px',
              boxShadow: `
                0 0 20px ${theme.particleColors[0]}40,
                0 0 40px ${theme.particleColors[0]}20,
                0 8px 25px rgba(0, 0, 0, 0.7),
                inset 0 1px 0 ${theme.particleColors[0]}20
              `,
              backdropFilter: 'blur(12px)'
            }}
          />

          {/* MiniMap protégée contre les erreurs NaN - Thème adaptatif */}
          {internalState.minimapReady && (
            <MiniMap
              key="minimap-unique"
              position="bottom-right"
              nodeStrokeColor={(node) => {
                // ⭐ REMOVED: isMinimized check - now managed by useRuntimeStore
                // Utiliser la couleur primaire du thème actuel
                return theme.particleColors[0] || '#00ffff';
              }}
              nodeColor={(node) => {
                // ⭐ REMOVED: isMinimized check - now managed by useRuntimeStore
                const agentId = node.data?.robotId || '';

                // Couleurs adaptées au thème
                if (theme.timeOfDay === 'morning') {
                  // Matin : couleurs forestières
                  if (agentId.includes('archi')) return 'rgba(34, 197, 94, 0.8)'; // Vert forêt
                  if (agentId.includes('bos')) return 'rgba(251, 191, 36, 0.8)'; // Doré
                  if (agentId.includes('com')) return 'rgba(74, 222, 128, 0.8)'; // Vert clair
                  if (agentId.includes('phil')) return 'rgba(134, 239, 172, 0.8)'; // Vert pastel
                  if (agentId.includes('tim')) return 'rgba(253, 224, 71, 0.8)'; // Jaune soleil
                } else {
                  // Nuit/Après-midi : couleurs neon
                  if (agentId.includes('archi')) return 'rgba(0, 255, 255, 0.8)'; // Cyan
                  if (agentId.includes('bos')) return 'rgba(255, 165, 0, 0.8)'; // Orange
                  if (agentId.includes('com')) return 'rgba(0, 255, 0, 0.8)'; // Vert neon
                  if (agentId.includes('phil')) return 'rgba(138, 43, 226, 0.8)'; // Violet
                  if (agentId.includes('tim')) return 'rgba(255, 20, 147, 0.8)'; // Rose neon
                }

                return 'rgba(26, 26, 26, 0.9)';
              }}
              nodeClassName={(node) => {
                return 'minimap-node-striped';
              }}
              nodeBorderRadius={8}
              pannable
              zoomable
              maskColor={theme.timeOfDay === 'morning' ? 'rgba(5, 46, 22, 0.6)' : 'rgba(0, 20, 40, 0.6)'}
              className="workflow-minimap-fixed"
              style={{
                width: 200,
                height: 140,
                background: theme.backgroundGradient,
                border: `2px solid ${theme.particleColors[0]}`,
                borderRadius: '12px',
                opacity: 0.95,
                boxShadow: `0 0 20px ${theme.primaryColor}, 0 8px 25px rgba(0, 0, 0, 0.7)`
              }}
            />
          )}

          {/* ⭐ ÉTAPE 2: Bouton de sauvegarde manuelle - Au-dessus des Controls, aligné verticalement */}
          {/* Le bouton gère lui-même sa visibilité via useSaveMode (isManualSave && isAuthenticated) */}
          <div className="workflow-save-button-fixed">
            <SavePrototypeButton
              workflowId={effectiveWorkflowId}
              workflowName={workflowName}
              canvasState={{
                zoom: reactFlowInstance.getZoom(),
                panX: reactFlowInstance.getViewport().x,
                panY: reactFlowInstance.getViewport().y
              }}
              onSaveComplete={onSaveComplete}
            />
          </div>

          {/* ⭐ PLAN_DE_PERSISTENCE: Indicateur de sauvegarde automatique */}
          <div className="workflow-autosave-indicator-fixed">
            <AutoSaveIndicator
              status={autoSave.status}
              lastSavedAt={autoSave.lastSavedAt}
              error={autoSave.error}
              isEnabled={autoSave.isEnabled}
            />
          </div>
        </ReactFlow>

        {/* ⭐ Lasso du mode clic : fil entre la poignée cliquée et le curseur (recréé par l'app,
            RF 11.11.4 ne le rend pas en mode clic). Coordonnées relatives à ce conteneur. */}
        {clickLasso && (
          <svg className="workflow-click-lasso" aria-hidden="true">
            <path
              className="workflow-click-lasso-path"
              d={(() => {
                const dx =
                  Math.max(40, Math.abs(clickLasso.x2 - clickLasso.x1) / 2) *
                  (clickLasso.handleType === 'source' ? 1 : -1);
                return `M ${clickLasso.x1} ${clickLasso.y1} C ${clickLasso.x1 + dx} ${clickLasso.y1}, ${clickLasso.x2 - dx} ${clickLasso.y2}, ${clickLasso.x2} ${clickLasso.y2}`;
              })()}
            />
          </svg>
        )}

        {/* Bouton flottant redirection vers prototypage Archi - Style Blur futuriste */}
        {onAddToWorkflow && onNavigate && (
          <button
            onClick={() => onNavigate(RobotId.Archi, '/archi/prototyping')}
            className="absolute bottom-8 left-8 group"
            style={{
              background: 'linear-gradient(135deg, rgba(0, 255, 255, 0.2) 0%, rgba(0, 0, 0, 0.8) 100%)',
              border: '2px solid rgba(0, 255, 255, 0.6)',
              borderRadius: '16px',
              boxShadow: `
                0 0 25px rgba(0, 255, 255, 0.4),
                0 0 50px rgba(0, 255, 255, 0.2),
                0 8px 32px rgba(0, 0, 0, 0.8),
                inset 0 1px 0 rgba(0, 255, 255, 0.2)
              `,
              backdropFilter: 'blur(15px)',
              padding: '12px 20px',
              fontSize: '14px',
              fontWeight: 'bold',
              color: '#00ffff',
              textShadow: '0 0 10px rgba(0, 255, 255, 0.5)',
              transition: 'all 0.3s ease',
              cursor: 'pointer'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = `
                0 0 35px rgba(0, 255, 255, 0.6),
                0 0 70px rgba(0, 255, 255, 0.3),
                0 12px 40px rgba(0, 0, 0, 0.9)
              `;
              e.currentTarget.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = `
                0 0 25px rgba(0, 255, 255, 0.4),
                0 0 50px rgba(0, 255, 255, 0.2),
                0 8px 32px rgba(0, 0, 0, 0.8),
                inset 0 1px 0 rgba(0, 255, 255, 0.2)
              `;
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            <span className="flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
              </svg>
              Prototype Agent
            </span>
          </button>
        )}

        {/* Modal de confirmation d'édition de prototype */}
        <PrototypeEditConfirmationModal
          isOpen={internalState.showPrototypeConfirm}
          agentName={internalState.selectedAgentForEdit ?
            reactFlowNodes.find(n => n.id === internalState.selectedAgentForEdit)?.data?.agentInstance?.name ||
            reactFlowNodes.find(n => n.id === internalState.selectedAgentForEdit)?.data?.agent?.name ||
            'Agent'
            : 'Agent'
          }
          onConfirm={handleConfirmPrototypeEdit}
          onCancel={handleCancelPrototypeEdit}
        />

        {/* Modal de formulaire d'agent */}
        {internalState.showAgentForm && (
          <AgentFormModal
            onClose={() => setInternalState(prev => ({ ...prev, showAgentForm: false }))}
            onSave={(agentData: AgentDraft) => {
              // Générer un ID pour l'agent si pas fourni
              const now = new Date().toISOString();
              const agentWithId: Agent = {
                ...agentData,
                id: `agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                creator_id: RobotId.Archi,
                created_at: now,
                updated_at: now,
              };
              if (onAddToWorkflow) onAddToWorkflow(agentWithId);
              setInternalState(prev => ({ ...prev, showAgentForm: false }));
            }}
            llmConfigs={llmConfigs}
            existingAgent={null}
          />
        )}
      </div>
    </WorkflowCanvasProvider>
  );
});

// Wrapper avec ReactFlowProvider pour accès à useReactFlow
const WorkflowCanvas = memo(function WorkflowCanvas(props: WorkflowCanvasProps) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner {...props} />
    </ReactFlowProvider>
  );
});

// Export direct du composant avec provider
export default WorkflowCanvas;

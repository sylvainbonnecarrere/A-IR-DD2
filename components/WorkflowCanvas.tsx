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
import { Agent, AgentDraft, WorkflowNode, LLMConfig, AgentInstance, NodePositionUpdateOptions, RobotId, V2WorkflowNode, ChatMessage, MapsPanelPreloadedResults } from '../types';
import { useDesignStore } from '../stores/useDesignStore';
import { useWorkflowStore } from '../stores/useWorkflowStore';
import { useAuth } from '../contexts/AuthContext';
import { isValidWorkflowConnection } from './workflow/connectionContracts';
import { registerReactFlowWarningProbe } from '../utils/reactFlowWarningDiagnostics';
import { findCollisionFreeWorkflowNodePosition } from '../utils/workflowNodePlacement';
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
  onNavigate?: (robotId: any, path: string) => void; // Pour navigation vers prototypage
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
let workflowCanvasMountSequence = 0;
type ReactFlowNodeWithMeasuredSize = Node & { measured?: { height?: number; width?: number } };
type ReactFlowNodeLookup = {
  getNode?: (nodeId: string) => ReactFlowNodeWithMeasuredSize | undefined;
  getNodes?: () => ReactFlowNodeWithMeasuredSize[];
};

// Composant interne avec accès à useReactFlow
const WorkflowCanvasInner = memo(function WorkflowCanvasInner(props: WorkflowCanvasProps) {
  const {
    nodes = [],
    llmConfigs = [],
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
    agents = [],
    onAddToWorkflow,
    onUpdateWorkflowNode,
    onRemoveFromWorkflow,
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
  const [layoutStabilityRevision, setLayoutStabilityRevision] = useState(0);
  const [initialViewportSettledRevision, setInitialViewportSettledRevision] = useState(0);
  if (workflowCanvasMountIdRef.current === 0) {
    workflowCanvasMountIdRef.current = ++workflowCanvasMountSequence;
  }

  // ⭐ SELF-HEALING: Get real workflow ID from store (falls back to prop)
  const { getCurrentWorkflowId } = useWorkflowStore();
  const storeWorkflowId = getCurrentWorkflowId();
  const workflowId = storeWorkflowId || workflowIdProp || 'default-workflow';

  // Hook de thème jour/nuit
  const theme = useDayNightTheme();

  // Hook React Flow pour fitView
  const reactFlowInstance = useReactFlow();
  const reactFlowLookup = reactFlowInstance as typeof reactFlowInstance & ReactFlowNodeLookup;

  // ISOLATION COMPLÈTE: un seul useState pour éviter les conflits React Flow
  const [internalState, setInternalState] = useState({
    showAgentForm: false,
    showPrototypeConfirm: false,
    selectedAgentForEdit: null as string | null,
    minimapReady: false, // Ajout pour contrôler le rendu de la MiniMap
  });

  // Ref pour tracker si on a déjà centré la vue au chargement initial
  const hasInitialCentered = useRef(false);

  const markInitialViewportSettled = useCallback((note: string) => {
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
    defaultViewport: DEFAULT_VIEWPORT,
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

  // Wrapper sécurisé pour onNodesChange avec logging d'erreurs
  const onNodesChange = useCallback((changes: any) => {
    try {
      onNodesChangeInternal(changes);
    } catch (error) {
      console.error('[WorkflowCanvas] Error in onNodesChange:', error);
      // Ne pas propager l'erreur pour éviter de casser l'UI
    }
  }, [onNodesChangeInternal]);

  // ⭐ FIX SOLID: Utiliser la source unique de vérité pour les nodes.
  // Le chemin actif du runtime lit désormais le store, avec `nodes` comme compatibilité explicite.
  const { nodes: storeNodes } = useDesignStore();
  
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
    defaultViewportStable: reactFlowContractRef.current.defaultViewport === DEFAULT_VIEWPORT,
    proOptionsStable: reactFlowContractRef.current.proOptions === PRO_OPTIONS,
  };

  stableRefs.current.actualNodes = actualNodes;
  stableRefs.current.reactFlowNodes = reactFlowNodes;

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
    const getNodeWidth = (candidate?: ReactFlowNodeWithMeasuredSize) => candidate?.measured?.width ?? candidate?.width;
    const getNodeHeight = (candidate?: ReactFlowNodeWithMeasuredSize) => candidate?.measured?.height ?? candidate?.height;
    const movedLiveNode = liveNodes.find((candidate) => candidate.id === nodeId);
    const occupiedNodeRects = liveNodes.flatMap((candidate) => {
      if (!Number.isFinite(candidate.position?.x) || !Number.isFinite(candidate.position?.y)) {
        return [];
      }

      return [{
        nodeId: candidate.id,
        instanceId: candidate.data?.agentInstance?.id,
        position: candidate.position,
        workflowId: candidate.data?.workflowId ?? candidate.data?.agentInstance?.workflowId ?? nodeWorkflowId ?? null,
        width: getNodeWidth(candidate),
        height: getNodeHeight(candidate),
      }];
    });

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
        width: draggedNodeSize?.width ?? getNodeWidth(movedLiveNode),
        height: draggedNodeSize?.height ?? getNodeHeight(movedLiveNode),
      },
      gestureVector,
    });
  }, [reactFlowInstance, workflowId]);

  const onNodeDragStop = useCallback((_: unknown, node: ReactFlowNodeWithMeasuredSize) => {
    try {
      const resolvedPosition = resolveDroppedNodePosition(node.id, node.position, {
        width: node.measured?.width ?? node.width,
        height: node.measured?.height ?? node.height,
      });

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
    // Wrapper: when toggle minimize/restore, re-measure DOM node size and re-evaluate collisions.
    // Important: moves caused by restore are applied locally (no persist) to avoid accidental DB writes for UI-only actions.
    onToggleNodeMinimize: (nodeId: string) => {
      try {
        // Call upstream handler (App) to toggle runtime state
        (onToggleNodeMinimize || (() => {}))(nodeId);

        // Wait for DOM/React updates (double rAF) then perform explicit perimeter check
        requestAnimationFrame(() => requestAnimationFrame(() => {
          try {
            const nodeEl = document.querySelector(`[data-id=\"${nodeId}\"]`) as HTMLElement | null;
            const measuredWidth = nodeEl?.offsetWidth ?? undefined;
            const measuredHeight = nodeEl?.offsetHeight ?? undefined;

            // Update measured size on the visual node
            if (typeof measuredWidth === 'number' || typeof measuredHeight === 'number') {
              setReactFlowNodes((current) => current.map((n) => {
                if (n.id !== nodeId) return n;
                const measuredNode = n as ReactFlowNodeWithMeasuredSize;
                return {
                  ...measuredNode,
                  measured: {
                    width: measuredWidth ?? measuredNode.measured?.width ?? measuredNode.width,
                    height: measuredHeight ?? measuredNode.measured?.height ?? measuredNode.height,
                  },
                };
              }));
            }

            const designState = useDesignStore.getState();
            const movedNode = designState.nodes.find((candidate) => candidate.id === nodeId);

            // Prefer live visual position, fall back to design position
            const liveNode = typeof reactFlowLookup.getNode === 'function'
              ? reactFlowLookup.getNode(nodeId)
              : stableRefs.current.reactFlowNodes.find((n) => n.id === nodeId);

            const hasValidLivePosition = liveNode && Number.isFinite(liveNode.position?.x) && Number.isFinite(liveNode.position?.y);
            const designPositionValid = movedNode && Number.isFinite(movedNode.position?.x) && Number.isFinite(movedNode.position?.y);
            const desiredPosition = hasValidLivePosition ? liveNode.position : (designPositionValid ? movedNode.position : undefined);
            if (!desiredPosition) return;

            // If measured values are still small (minimized), use expanded fallback for collision perimeter
            const expandedFallback = { width: 384, height: 550 };
            const subjectWidth = (typeof measuredWidth === 'number' && measuredWidth > 300) ? measuredWidth : expandedFallback.width;
            const subjectHeight = (typeof measuredHeight === 'number' && measuredHeight > 300) ? measuredHeight : expandedFallback.height;

            // Build live occupied rects from visual nodes
            const liveNodes: ReactFlowNodeWithMeasuredSize[] = typeof reactFlowLookup.getNodes === 'function'
              ? reactFlowLookup.getNodes()
              : (stableRefs.current.reactFlowNodes as ReactFlowNodeWithMeasuredSize[]);

            const occupiedNodeRects = liveNodes.flatMap((candidate) => {
              if (!Number.isFinite(candidate.position?.x) || !Number.isFinite(candidate.position?.y)) return [];
              return [{
                nodeId: candidate.id,
                instanceId: candidate.data?.agentInstance?.id,
                position: candidate.position,
                workflowId: candidate.data?.workflowId ?? candidate.data?.agentInstance?.workflowId ?? workflowId ?? null,
                width: candidate.measured?.width ?? candidate.width,
                height: candidate.measured?.height ?? candidate.height,
              }];
            });

            // Ask placement util for a non-overlapping position using expanded subject size
            try {
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

              if (resolved && (resolved.x !== desiredPosition.x || resolved.y !== desiredPosition.y)) {
                setReactFlowNodes((current) => current.map((n) => n.id === nodeId ? { ...n, position: resolved } : n));
                // Apply visual-only correction; do not persist automatically on restore
                (onUpdateNodePosition || (() => {}))(nodeId, resolved, { persist: false });
              }
            } catch (traceErr) {
              // Do not break UI on trace calculation failures
              // eslint-disable-next-line no-console
              console.warn('[WorkflowCanvas] perimeter-check/resolve failed', traceErr);
            }
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn('[WorkflowCanvas] perimeter-check/restore correction failed:', err);
          }
        }));
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
  const { agentInstances, getResolvedInstance } = useDesignStore();

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
          // Si un nouveau node a été ajouté, centrer la vue sur lui après un court délai
          if (newReactFlowNodes.length > currentNodes.length && reactFlowInstance) {
            const newNode = newReactFlowNodes[newReactFlowNodes.length - 1];
            setTimeout(() => {
              // Obtenir le node React Flow pour accéder à ses dimensions réelles
              const rfNode = reactFlowInstance.getNode(newNode.id);
              if (rfNode) {
                // Calculer le centre VISUEL du node (position.y est en haut du node)
                // Le node a une hauteur d'environ 500-600px (header + chat + controls)
                const nodeWidth = rfNode.width || 400;
                const nodeHeight = rfNode.height || 550; // Hauteur approximative d'un agent

                const centerX = rfNode.position.x + (nodeWidth / 2);
                const centerY = rfNode.position.y + (nodeHeight / 2);

                reactFlowInstance.setCenter(centerX, centerY, {
                  zoom: 0.7,      // Zoom plus large pour voir l'agent entier avec marge
                  duration: 800,  // Animation fluide
                });
              }
            }, 250); // Délai pour que le DOM soit complètement rendu avec dimensions
          }
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
    } else {
      setReactFlowNodes(currentNodes => currentNodes.length > 0 ? [] : currentNodes);
    }
  }, [actualNodes, agentInstances, agents, getResolvedInstance, reactFlowInstance, workflowId]);

  // useEffect pour centrer la vue sur les nodes existants au chargement initial UNIQUEMENT
  useEffect(() => {
    if (!reactFlowInstance) {
      return undefined;
    }

    if (reactFlowNodes.length === 0) {
      if (!initialViewportSettledRef.current) {
        markInitialViewportSettled('empty-canvas');
      }
      return undefined;
    }

    if (hasInitialCentered.current) {
      return undefined;
    }

    let cancelled = false;
    let attempts = 0;
    let frameId = 0;

    const centerInitialViewport = () => {
      if (cancelled) {
        return;
      }

      const firstNode = reactFlowInstance.getNode(reactFlowNodes[0].id) as ReactFlowNodeWithMeasuredSize | undefined;
      const nodeWidth = firstNode?.measured?.width ?? firstNode?.width ?? 0;
      const nodeHeight = firstNode?.measured?.height ?? firstNode?.height ?? 0;

      if (!firstNode || nodeWidth <= 0 || nodeHeight <= 0) {
        if (attempts >= 12) {
          hasInitialCentered.current = true;
          markInitialViewportSettled('fallback-without-dimensions');
          return;
        }

        attempts += 1;
        frameId = window.requestAnimationFrame(centerInitialViewport);
        return;
      }

      hasInitialCentered.current = true;
      const centerX = firstNode.position.x + (nodeWidth / 2);
      const centerY = firstNode.position.y + (nodeHeight / 2);
      reactFlowInstance.setCenter(centerX, centerY, {
        zoom: 0.7,
        duration: 0,
      });

      frameId = window.requestAnimationFrame(() => {
        if (cancelled) {
          return;
        }
        markInitialViewportSettled('initial-node-center');
      });
    };

    frameId = window.requestAnimationFrame(centerInitialViewport);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
    };
  }, [markInitialViewportSettled, reactFlowInstance, reactFlowNodes]); // Se déclenche au chargement initial uniquement

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
      pane.focus();
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
          connectionMode={ConnectionMode.Strict}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          style={REACT_FLOW_STYLE}
          defaultViewport={DEFAULT_VIEWPORT}
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

        {/* Bouton flottant redirection vers prototypage Archi - Style Blur futuriste */}
        {onAddToWorkflow && onNavigate && (
          <button
            onClick={() => onNavigate('AR_001', '/archi/prototyping')}
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

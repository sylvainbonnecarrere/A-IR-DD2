import React, { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
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
import { Agent, WorkflowNode, LLMConfig, AgentInstance } from '../types';
import { useDesignStore } from '../stores/useDesignStore';
import { useWorkflowStore } from '../stores/useWorkflowStore';
import { useAuth } from '../contexts/AuthContext';
import { isValidWorkflowConnection } from './workflow/connectionContracts';

interface WorkflowCanvasProps {
  nodes?: WorkflowNode[];
  llmConfigs?: LLMConfig[];
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
  agents?: Agent[];
  workflowNodes?: WorkflowNode[];
  onAddToWorkflow?: (agent: Agent) => void;
  onUpdateWorkflowNode?: (nodeId: string, updates: Partial<WorkflowNode>) => void;
  onRemoveFromWorkflow?: (nodeId: string) => void;
  onNavigate?: (robotId: any, path: string) => void; // Pour navigation vers prototypage
  // Détection des panneaux actifs pour calcul largeur maximized
  isImagePanelOpen?: boolean;
  isImageModificationPanelOpen?: boolean;
  isVideoPanelOpen?: boolean;
  isMapsPanelOpen?: boolean;
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

// Composant interne avec accès à useReactFlow
const WorkflowCanvasInner = memo(function WorkflowCanvasInner(props: WorkflowCanvasProps) {
  const {
    nodes = [],
    llmConfigs = [],
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
    agents = [],
    workflowNodes = [],
    onAddToWorkflow,
    onUpdateWorkflowNode,
    onRemoveFromWorkflow,
    onNavigate,
    isImagePanelOpen = false,
    isImageModificationPanelOpen = false,
    isVideoPanelOpen = false,
    isMapsPanelOpen = false,
    // ⭐ ÉTAPE 2: Persistence props
    workflowId: workflowIdProp,
    workflowName,
    onSaveComplete
  } = props;

  const { isAuthenticated } = useAuth();

  // ⭐ SELF-HEALING: Get real workflow ID from store (falls back to prop)
  const { getCurrentWorkflowId } = useWorkflowStore();
  const storeWorkflowId = getCurrentWorkflowId();
  const workflowId = storeWorkflowId || workflowIdProp || 'default-workflow';

  // Hook de thème jour/nuit
  const theme = useDayNightTheme();

  // Hook React Flow pour fitView
  const reactFlowInstance = useReactFlow();

  // ISOLATION COMPLÈTE: un seul useState pour éviter les conflits React Flow
  const [internalState, setInternalState] = useState({
    showAgentForm: false,
    showPrototypeConfirm: false,
    selectedAgentForEdit: null as string | null,
    minimapReady: false, // Ajout pour contrôler le rendu de la MiniMap
  });

  // Ref pour tracker si on a déjà centré la vue au chargement initial
  const hasInitialCentered = useRef(false);

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
    actualNodes: [] as WorkflowNode[],
    agents: [] as Agent[],
    reactFlowNodes: [] as Node[]
  });

  // Hooks React Flow - avec gestion d'erreur pour éviter les crashes
  const [reactFlowNodes, setReactFlowNodes, onNodesChangeInternal] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // Wrapper sécurisé pour onNodesChange avec logging d'erreurs
  const onNodesChange = useCallback((changes: any) => {
    try {
      onNodesChangeInternal(changes);
    } catch (error) {
      console.error('[WorkflowCanvas] Error in onNodesChange:', error);
      // Ne pas propager l'erreur pour éviter de casser l'UI
    }
  }, [onNodesChangeInternal]);

  // ⭐ FIX SOLID: Utiliser la source unique de vérité pour les nodes
  // Priorité: storeNodes (source officielle) > nodes props > fallback
  // REVERT: Revenir à storeNodes comme priorité 1 pour éviter perte des journaux et recentrage
  const { nodes: storeNodes } = useDesignStore();
  
  // Calculer actualNodes de manière stable
  const actualNodes = useMemo(() => {
    // ⭐ PRIORITÉ 1: storeNodes (source officielle - garantit persistance des journaux)
    if (storeNodes && storeNodes.length > 0) {
      return storeNodes;
    }
    // Priorité 2: nodes passés en props
    if (nodes && nodes.length > 0) {
      return nodes;
    }
    // Fallback: workflowNodes legacy
    return workflowNodes;
  }, [storeNodes, nodes, workflowNodes]);

  // Détecter si un panneau média est actif (pour calcul largeur maximized)
  const isMediaPanelActive = isImagePanelOpen || isImageModificationPanelOpen || isVideoPanelOpen || isMapsPanelOpen;

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
    onToggleNodeMinimize: onToggleNodeMinimize || (() => { }),
    onToggleNodeMaximize: onToggleNodeMaximize || (() => { }),
    onOpenImagePanel: onOpenImagePanel || (() => { }),
    onOpenImageModificationPanel: onOpenImageModificationPanel || (() => { }),
    onOpenFullscreen: onOpenFullscreen || (() => { })
  };

  // Ref stable pour agents (évite les dépendances cycliques)
  stableRefs.current.agents = agents;

  // Récupérer les instances depuis le store pour synchronisation
  const { agentInstances, getResolvedInstance } = useDesignStore();

  // SOLUTION ANTI-BOUCLE: useEffect unique et stable pour éviter les conflits
  useEffect(() => {
    if (actualNodes && actualNodes.length > 0) {
      const newReactFlowNodes: Node[] = actualNodes.map((wfNode, index) => {
        // ⭐ SUPPORT BOTH NODE TYPES: V2WorkflowNode (from store) and WorkflowNode (legacy)
        // V2WorkflowNode has wfNode.data.agentInstance (already resolved from store)
        // WorkflowNode has wfNode.instanceId (legacy, needs resolution from store)
        
        let agentInstance = null;
        let agent = null;
        let robotId = 'unknown';
        let position = { x: 100 + index * 200, y: 100 + index * 150 };
        let nodeWorkflowId = workflowId;
        
        // Check if it's a V2WorkflowNode (has data property)
        if ('data' in wfNode && wfNode.data) {
          // V2WorkflowNode from store - use data directly
          agentInstance = wfNode.data.agentInstance || null;
          agent = wfNode.data.agent || null;
          robotId = wfNode.data.robotId || 'unknown';
          position = wfNode.position || position;
          nodeWorkflowId = wfNode.data.workflowId || workflowId;
          
          // ⭐ FIX: Si agentInstance existe mais n'a pas de workflowId, l'ajouter
          if (agentInstance && !agentInstance.workflowId) {
            agentInstance = { ...agentInstance, workflowId: nodeWorkflowId };
          }
        } else {
          // WorkflowNode (legacy) - has instanceId, need to resolve from store
          const resolved = wfNode.instanceId ? getResolvedInstance(wfNode.instanceId) : null;
          
          if (!resolved && wfNode.instanceId) {
            // ⭐ FIX: Chercher aussi directement dans agentInstances par ID
            const directInstance = agentInstances.find(i => i.id === wfNode.instanceId);
            if (directInstance) {
              agentInstance = { ...directInstance, workflowId: directInstance.workflowId || workflowId };
              console.log('[WorkflowCanvas] Found instance directly:', wfNode.instanceId);
            } else {
              console.warn(`[WorkflowCanvas] Instance not found for instanceId: ${wfNode.instanceId}. Available instances:`, 
                agentInstances.map(i => ({ id: i.id, prototypeId: i.prototypeId }))
              );
            }
          } else if (resolved) {
            agentInstance = { ...resolved.instance, workflowId: resolved.instance.workflowId || workflowId };
          }
          
          agent = wfNode.agent || null;
          robotId = wfNode.agent?.id || 'unknown';
          position = wfNode.position || position;
        }

        return {
          id: wfNode.id || `node-${index}`,
          type: 'customAgent',
          position,
          data: {
            robotId,
            label: agentInstance?.name || (wfNode.agent?.name || 'Agent'),
            agent: agent || wfNode.agent, // ⭐ FIX: Utiliser agent résolu ou celui du legacy node
            agentInstance, // Instance mise à jour depuis le store (peut être null)
            workflowId: nodeWorkflowId, // ⭐ FIX: Utiliser le workflowId du node
            // ⭐ REMOVED: isMinimized, isMaximized - now managed by useRuntimeStore (transient UI state)
          },
        };
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
  }, [actualNodes, agentInstances, getResolvedInstance]); // Ajouter agentInstances pour reactivity

  // useEffect pour centrer la vue sur les nodes existants au chargement initial UNIQUEMENT
  useEffect(() => {
    if (reactFlowNodes.length > 0 && reactFlowInstance && !hasInitialCentered.current) {
      hasInitialCentered.current = true; // Marquer comme fait
      setTimeout(() => {
        // Prendre le premier node pour centrer la vue
        const firstNode = reactFlowInstance.getNode(reactFlowNodes[0].id);
        if (firstNode) {
          const nodeWidth = firstNode.width || 400;
          const nodeHeight = firstNode.height || 550;
          const centerX = firstNode.position.x + (nodeWidth / 2);
          const centerY = firstNode.position.y + (nodeHeight / 2);

          reactFlowInstance.setCenter(centerX, centerY, {
            zoom: 0.7,
            duration: 0, // Pas d'animation au chargement initial
          });
        }
      }, 300); // Délai pour que React Flow calcule les dimensions
    }
  }, [reactFlowNodes.length, reactFlowInstance]); // Se déclenche au chargement initial uniquement

  // useEffect pour initialiser la MiniMap immédiatement (pas de délai pour éviter desync)
  useEffect(() => {
    // Initialiser immédiatement pour éviter la désynchronisation
    setInternalState(prev => ({ ...prev, minimapReady: true }));
  }, []);

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
        const agent = Array.isArray(currentAgents) ? currentAgents.find(a => a && a.id === workflowNode.agentId) : null;
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
      onToggleNodeMinimize,
      onToggleNodeMaximize,
      onUpdateNodePosition,
      onOpenImagePanel,
      onOpenImageModificationPanel,
      onOpenVideoPanel,
      onOpenMapsPanel,
      onOpenFullscreen,
    }), [handleEditPrototype, onNavigate, onDeleteNode, onToggleNodeMinimize, onToggleNodeMaximize, onUpdateNodePosition, onOpenImagePanel, onOpenImageModificationPanel, onOpenVideoPanel, onOpenMapsPanel, onOpenFullscreen]);

  // Calcul dynamique de la largeur maximale pour le mode maximized
  // Si un panneau média est actif, largeur = viewport - panneau (environ 600px)
  // Sinon, largeur = 100% du workflow canvas
  const maximizedWidth = isMediaPanelActive ? 'calc(100vw - 650px)' : 'calc(100vw - 100px)';
  const maximizedHeight = 'calc(100vh - 150px)';
  const effectiveWorkflowId = workflowId === 'default-workflow' && isAuthenticated ? undefined : workflowId;

  return (
    <WorkflowCanvasProvider value={contextValue}>
      {/* Style dynamique pour la classe workflow-maximized */}
      <style>{`
        .workflow-maximized {
          width: ${maximizedWidth} !important;
          height: ${maximizedHeight} !important;
          max-width: none !important;
          z-index: 999 !important;
          position: relative !important;
        }
        
        .workflow-maximized .flex-1 {
          max-height: calc(${maximizedHeight} - 100px) !important;
        }
      `}</style>
      <div className="h-full w-full relative overflow-hidden">
        {/* Background optimisé avec thème jour/nuit */}
        <OptimizedWorkflowBackground />

        <ReactFlow
          nodes={reactFlowNodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          isValidConnection={isValidWorkflowConnection}
          onPaneClick={handlePaneClick}
          connectionMode={ConnectionMode.Strict}
          nodeTypes={NODE_TYPES}
          style={{ background: 'transparent' }}
          defaultViewport={{ x: 0, y: 0, zoom: 0.7 }}
          proOptions={{ hideAttribution: true }}
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
              width={200}
              height={140}
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
            reactFlowNodes.find(n => n.id === internalState.selectedAgentForEdit)?.data?.workflowNode?.name || 'Agent'
            : 'Agent'
          }
          onConfirm={handleConfirmPrototypeEdit}
          onCancel={handleCancelPrototypeEdit}
        />

        {/* Modal de formulaire d'agent */}
        {internalState.showAgentForm && (
          <AgentFormModal
            onClose={() => setInternalState(prev => ({ ...prev, showAgentForm: false }))}
            onSave={(agentData) => {
              // Générer un ID pour l'agent si pas fourni
              const agentWithId: Agent = {
                ...agentData,
                id: `agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
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

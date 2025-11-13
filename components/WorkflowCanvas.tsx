import React, { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Node,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { V2AgentNode } from './V2AgentNode';
import { OptimizedWorkflowBackground } from './OptimizedWorkflowBackground';
import { useDayNightTheme } from '../hooks/useDayNightTheme';
import { WorkflowCanvasProvider } from '../contexts/WorkflowCanvasContext';
import { PrototypeEditConfirmationModal } from './modals/PrototypeEditConfirmationModal';
import { AgentFormModal } from './modals/AgentFormModal';
import { Agent, WorkflowNode, LLMConfig } from '../types';

interface WorkflowCanvasProps {
  nodes?: WorkflowNode[];
  llmConfigs?: LLMConfig[];
  onDeleteNode?: (nodeId: string) => void;
  onUpdateNodeMessages?: (nodeId: string, messages: any[]) => void;
  onUpdateNodePosition?: (nodeId: string, position: { x: number; y: number }) => void;
  onToggleNodeMinimize?: (nodeId: string) => void;
  onOpenImagePanel?: (nodeId: string) => void;
  onOpenImageModificationPanel?: (nodeId: string) => void;
  onOpenFullscreen?: (nodeId: string) => void;
  agents?: Agent[];
  workflowNodes?: WorkflowNode[];
  onAddToWorkflow?: (agent: Agent) => void;
  onUpdateWorkflowNode?: (nodeId: string, updates: Partial<WorkflowNode>) => void;
  onRemoveFromWorkflow?: (nodeId: string) => void;
  onNavigate?: (robotId: any, path: string) => void; // Pour navigation vers prototypage
}

// nodeTypes défini GLOBALEMENT pour éviter les re-créations
const NODE_TYPES = {
  customAgent: V2AgentNode,
} as const;

// Mémoriser le composant ReactFlow pour éviter les re-renders
const MemoizedReactFlow = memo(ReactFlow);

// Composant interne avec isolation complète
const WorkflowCanvasInner = memo(function WorkflowCanvasInner(props: WorkflowCanvasProps) {
  const {
    nodes = [],
    llmConfigs = [],
    onDeleteNode,
    onUpdateNodeMessages,
    onUpdateNodePosition,
    onToggleNodeMinimize,
    onOpenImagePanel,
    onOpenImageModificationPanel,
    onOpenFullscreen,
    agents = [],
    workflowNodes = [],
    onAddToWorkflow,
    onUpdateWorkflowNode,
    onRemoveFromWorkflow,
    onNavigate
  } = props;

  // Hook de thème jour/nuit
  const theme = useDayNightTheme();

  // Mémorisation explicite de NODE_TYPES pour satisfaire React Flow
  const nodeTypes = useMemo(() => NODE_TYPES, []);

  // ISOLATION COMPLÈTE: un seul useState pour éviter les conflits React Flow
  const [internalState, setInternalState] = useState({
    showAgentForm: false,
    showPrototypeConfirm: false,
    selectedAgentForEdit: null as string | null,
    minimapReady: false, // Ajout pour contrôler le rendu de la MiniMap
  });

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

  // Hooks React Flow - MAIS nous allons les contrôler manuellement
  const [reactFlowNodes, setReactFlowNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // Calculer actualNodes de manière stable
  const actualNodes = useMemo(() => {
    return (nodes && nodes.length > 0) ? nodes : workflowNodes;
  }, [nodes, workflowNodes]);

  // Mettre à jour les références SANS déclencher de re-render
  stableRefs.current.callbacks = {
    onDeleteNode: onDeleteNode || (() => { }),
    onUpdateNodeMessages: onUpdateNodeMessages || (() => { }),
    onUpdateNodePosition: onUpdateNodePosition || (() => { }),
    onToggleNodeMinimize: onToggleNodeMinimize || (() => { }),
    onOpenImagePanel: onOpenImagePanel || (() => { }),
    onOpenImageModificationPanel: onOpenImageModificationPanel || (() => { }),
    onOpenFullscreen: onOpenFullscreen || (() => { })
  };

  stableRefs.current.actualNodes = actualNodes;
  stableRefs.current.agents = agents;

  // SOLUTION ANTI-BOUCLE: useEffect unique et stable pour éviter les conflits
  useEffect(() => {
    if (actualNodes && actualNodes.length > 0) {
      const newReactFlowNodes: Node[] = actualNodes.map((wfNode, index) => ({
        id: wfNode.id || `node-${index}`,
        type: 'customAgent',
        position: wfNode.position || { x: 100 + index * 200, y: 100 + index * 150 },
        data: {
          robotId: wfNode.agent?.id || 'unknown',
          label: wfNode.agent?.name || 'Agent',
          agent: wfNode.agent, // Utiliser directement wfNode.agent au lieu de chercher dans la liste
          agentInstance: wfNode,
          isMinimized: wfNode.isMinimized || false
        },
      }));

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
            currentNode.data.isMinimized !== newNode.data.isMinimized;
        });

        return hasChanged ? newReactFlowNodes : currentNodes;
      });
    } else {
      setReactFlowNodes(currentNodes => currentNodes.length > 0 ? [] : currentNodes);
    }
  }, [actualNodes]); // Suppression de la dépendance agents pour éviter les conflits

  // useEffect pour initialiser la MiniMap après que le composant soit monté
  useEffect(() => {
    const timer = setTimeout(() => {
      setInternalState(prev => ({ ...prev, minimapReady: true }));
    }, 100); // Délai court pour laisser le temps aux dimensions de se calculer

    return () => clearTimeout(timer);
  }, []);

  // Handlers stables avec useCallback
  const onConnect = useCallback((connection: Connection) => {
    setEdges((eds) => addEdge(connection, eds));
  }, [setEdges]);

  // Handler pour libérer le focus quand on clique sur le canvas
  const handlePaneClick = useCallback(() => {
    // Retirer le focus de tout élément actif (textarea, input, etc.)
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
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
    onUpdateNodePosition,
    onOpenImagePanel,
    onOpenImageModificationPanel,
    onOpenFullscreen,
  }), [handleEditPrototype, onNavigate, onDeleteNode, onToggleNodeMinimize, onUpdateNodePosition, onOpenImagePanel, onOpenImageModificationPanel, onOpenFullscreen]);

  return (
    <WorkflowCanvasProvider value={contextValue}>
      <div className="h-full w-full relative overflow-hidden">
        {/* Background optimisé avec thème jour/nuit */}
        <OptimizedWorkflowBackground />

        <MemoizedReactFlow
          key="workflow-canvas-main" // Clé unique pour éviter les re-créations
          nodes={reactFlowNodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onPaneClick={handlePaneClick}
          nodeTypes={nodeTypes}
          fitView
          style={{ background: 'transparent' }}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          proOptions={{ hideAttribution: true }} // Masquer le lien promotionnel React Flow
        >
          {/* MiniMap protégée contre les erreurs NaN - Thème adaptatif */}
          {internalState.minimapReady && (
            <MiniMap
              key="minimap-unique"
              width={200}
              height={140}
              nodeStrokeColor={(node) => {
                // Couleur adaptée au thème jour/nuit
                const isMinimized = node.data?.isMinimized;
                if (isMinimized) return '#666666';
                // Utiliser la couleur primaire du thème actuel
                return theme.particleColors[0] || '#00ffff';
              }}
              nodeColor={(node) => {
                const isMinimized = node.data?.isMinimized;
                const agentId = node.data?.robotId || '';

                if (isMinimized) return '#2a2a2a';

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
                boxShadow: `0 0 20px ${theme.primaryColor}, 0 8px 25px rgba(0, 0, 0, 0.7)`,
              }}
            />
          )}
          <Controls
            key="controls-unique" // Clé unique pour éviter les dédoublements
            position="top-right"
            style={{
              background: 'linear-gradient(135deg, rgba(0, 0, 0, 0.9) 0%, rgba(26, 26, 26, 0.8) 100%)',
              border: '2px solid rgba(255, 0, 255, 0.6)',
              borderRadius: '10px',
              boxShadow: `
                0 0 20px rgba(255, 0, 255, 0.4),
                0 0 40px rgba(255, 0, 255, 0.2),
                0 8px 25px rgba(0, 0, 0, 0.7),
                inset 0 1px 0 rgba(255, 0, 255, 0.2)
              `,
              backdropFilter: 'blur(12px)'
            }}
          />
        </MemoizedReactFlow>

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

// Export par défaut - composant wrapper simple et mémorisé
export default memo(function WorkflowCanvas(props: WorkflowCanvasProps) {
  return <WorkflowCanvasInner {...props} />;
});

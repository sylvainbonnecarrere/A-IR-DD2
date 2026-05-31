import { useState, useEffect, useMemo } from 'react';
import { Node, Edge, NodeChange, EdgeChange, applyNodeChanges, applyEdgeChanges, Connection } from 'reactflow';
import { WorkflowNode, NodePositionUpdateOptions } from '../types';
import { projectWorkflowNodesToReactFlowNodes } from '../services/workflowNodeReactFlowAdapter';

interface UseReactFlowAdapterProps {
  nodes: WorkflowNode[];
  onUpdateNodePosition: (nodeId: string, position: { x: number; y: number }, options?: NodePositionUpdateOptions) => void;
  onDeleteNode: (nodeId: string) => void;
}

interface ReactFlowState {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
}

export const useReactFlowAdapter = ({
  nodes: workflowNodes,
  onUpdateNodePosition,
  onDeleteNode,
}: UseReactFlowAdapterProps): ReactFlowState => {
  // Convertir WorkflowNode[] vers Node[] React Flow
  const reactFlowNodes = useMemo(() => {
    return projectWorkflowNodesToReactFlowNodes({
      workflowNodes,
      workflowId: 'default-workflow',
    }).map((node) => ({
      ...node,
      draggable: true,
    }));
  }, [workflowNodes]);

  // Pour l'instant, pas de connexions automatiques (à développer plus tard)
  const [edges, setEdges] = useState<Edge[]>([]);

  // Gérer les changements de nodes (position, suppression, etc.)
  const onNodesChange = (changes: NodeChange[]) => {
    changes.forEach((change) => {
      switch (change.type) {
        case 'position':
          if (change.position && change.dragging === false) {
            // Mettre à jour la position uniquement quand le drag est terminé
            onUpdateNodePosition(change.id, change.position, { persist: true });
          }
          break;
        case 'remove':
          onDeleteNode(change.id);
          break;
      }
    });
  };

  // Gérer les changements d'edges (pour plus tard)
  const onEdgesChange = (changes: EdgeChange[]) => {
    setEdges((eds) => applyEdgeChanges(changes, eds));
  };

  // Gérer les nouvelles connexions (pour plus tard)
  const onConnect = (connection: Connection) => {
    // TODO: Implémenter la logique de connexion entre agents
    console.log('Nouvelle connexion:', connection);
  };

  return {
    nodes: reactFlowNodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
  };
};
/**
 * @file useWorkflowData.ts
 * @description Hook personnalisé pour la gestion des workflows avec persistance intelligente
 * @domain Design Domain - Data Persistence
 *
 * Ce hook encapsule la logique de basculement API/localStorage.
 * Il utilise le contexte d'authentification pour déterminer le mode de persistance.
 *
 * USAGE:
 * ```tsx
 * const { workflows, loading, error, createWorkflow, saveWorkflow } = useWorkflowData();
 * ```
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import type { V2WorkflowNode, V2WorkflowEdge, Workflow, WorkflowEdge } from '../types';
import {
  WorkflowService,
  WorkflowNodeService,
  WorkflowEdgeService
} from '../services/workflowService';

interface UseWorkflowDataState {
  workflows: Workflow[];
  currentWorkflow: Workflow | null;
  nodes: V2WorkflowNode[];
  edges: V2WorkflowEdge[];
  loading: boolean;
  error: string | null;
}

interface UseWorkflowDataActions {
  loadWorkflows: () => Promise<void>;
  loadWorkflow: (workflowId: string) => Promise<void>;
  createWorkflow: (name: string, description?: string) => Promise<Workflow>;
  updateWorkflow: (workflowId: string, updates: Partial<Workflow>) => Promise<void>;
  deleteWorkflow: (workflowId: string) => Promise<void>;
  setActiveWorkflow: (workflowId: string) => Promise<void>;
  addNode: (workflowId: string, data: any) => Promise<V2WorkflowNode>;
  updateNode: (nodeId: string, updates: Partial<V2WorkflowNode>) => Promise<void>;
  deleteNode: (nodeId: string) => Promise<void>;
  addEdge: (source: string, target: string, workflowId: string) => Promise<V2WorkflowEdge>;
  deleteEdge: (edgeId: string) => Promise<void>;
  clearError: () => void;
}

export const useWorkflowData = (): UseWorkflowDataState & UseWorkflowDataActions => {
  const { isAuthenticated, accessToken, isLoading: authLoading } = useAuth();

  // State
  const [state, setState] = useState<UseWorkflowDataState>({
    workflows: [],
    currentWorkflow: null,
    nodes: [],
    edges: [],
    loading: false,
    error: null
  });

  /**
   * Options de persistance basées sur l'état d'authentification
   */
  const persistenceOptions = {
    isAuthenticated,
    token: accessToken
  };

  /**
   * Charger tous les workflows
   */
  const loadWorkflows = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const workflows = await WorkflowService.getAllWorkflows(persistenceOptions);
      setState(s => ({ ...s, workflows, loading: false }));
    } catch (err: any) {
      setState(s => ({
        ...s,
        error: err.message || 'Failed to load workflows',
        loading: false
      }));
    }
  }, [isAuthenticated, accessToken]);

  /**
   * Charger un workflow spécifique et ses nœuds/edges
   */
  const loadWorkflow = useCallback(async (workflowId: string) => {
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const workflow = await WorkflowService.getWorkflow(workflowId, persistenceOptions);
      const nodes = await WorkflowNodeService.getNodesByWorkflow(workflowId, persistenceOptions);
      const edges = await WorkflowEdgeService.getEdgesByWorkflow(workflowId, persistenceOptions);

      if (!workflow) {
        throw new Error('Workflow not found');
      }

      setState(s => ({
        ...s,
        currentWorkflow: workflow,
        nodes,
        edges,
        loading: false
      }));
    } catch (err: any) {
      setState(s => ({
        ...s,
        error: err.message || 'Failed to load workflow',
        loading: false
      }));
    }
  }, [isAuthenticated, accessToken]);

  /**
   * Créer un nouveau workflow
   */
  const createWorkflow = useCallback(
    async (name: string, description?: string): Promise<Workflow> => {
      setState(s => ({ ...s, loading: true, error: null }));
      try {
        const workflow = await WorkflowService.createWorkflow(
          { name, description } as Partial<Workflow>,
          persistenceOptions
        );
        setState(s => ({
          ...s,
          workflows: [...s.workflows, workflow],
          loading: false
        }));
        return workflow;
      } catch (err: any) {
        setState(s => ({
          ...s,
          error: err.message || 'Failed to create workflow',
          loading: false
        }));
        throw err;
      }
    },
    [isAuthenticated, accessToken]
  );

  /**
   * Mettre à jour un workflow
   */
  const updateWorkflow = useCallback(
    async (workflowId: string, updates: Partial<Workflow>) => {
      setState(s => ({ ...s, error: null }));
      try {
        const updated = await WorkflowService.updateWorkflow(
          workflowId,
          updates,
          persistenceOptions
        );
        setState(s => ({
          ...s,
          workflows: s.workflows.map(w => w._id === workflowId ? updated : w),
          currentWorkflow: s.currentWorkflow?._id === workflowId ? updated : s.currentWorkflow
        }));
      } catch (err: any) {
        setState(s => ({
          ...s,
          error: err.message || 'Failed to update workflow'
        }));
        throw err;
      }
    },
    [isAuthenticated, accessToken]
  );

  /**
   * Supprimer un workflow
   */
  const deleteWorkflow = useCallback(
    async (workflowId: string) => {
      setState(s => ({ ...s, error: null }));
      try {
        await WorkflowService.deleteWorkflow(workflowId, persistenceOptions);
        setState(s => ({
          ...s,
          workflows: s.workflows.filter(w => w._id !== workflowId),
          currentWorkflow: s.currentWorkflow?._id === workflowId ? null : s.currentWorkflow
        }));
      } catch (err: any) {
        setState(s => ({
          ...s,
          error: err.message || 'Failed to delete workflow'
        }));
        throw err;
      }
    },
    [isAuthenticated, accessToken]
  );

  /**
   * Activer un workflow (déactiver les autres)
   */
  const setActiveWorkflow = useCallback(
    async (workflowId: string) => {
      setState(s => ({ ...s, error: null }));
      try {
        const updated = await WorkflowService.setActiveWorkflow(
          workflowId,
          true,
          persistenceOptions
        );
        setState(s => ({
          ...s,
          workflows: s.workflows.map(w => ({
            ...w,
            isActive: w._id === workflowId
          })),
          currentWorkflow: s.currentWorkflow?._id === workflowId ? updated : s.currentWorkflow
        }));
      } catch (err: any) {
        setState(s => ({
          ...s,
          error: err.message || 'Failed to set active workflow'
        }));
        throw err;
      }
    },
    [isAuthenticated, accessToken]
  );

  /**
   * Ajouter un nœud au workflow courant
   */
  const addNode = useCallback(
    async (workflowId: string, data: any): Promise<V2WorkflowNode> => {
      setState(s => ({ ...s, error: null }));
      try {
        // Adapter les données au format V2WorkflowNode
        const nodeData: Partial<V2WorkflowNode> = {
          ...data,
          position: data?.position || { x: 0, y: 0 }
        };
        const node = await WorkflowNodeService.createNode(
          nodeData,
          persistenceOptions
        );
        setState(s => ({
          ...s,
          nodes: [...s.nodes, node]
        }));
        return node;
      } catch (err: any) {
        setState(s => ({
          ...s,
          error: err.message || 'Failed to add node'
        }));
        throw err;
      }
    },
    [isAuthenticated, accessToken]
  );

  /**
   * Mettre à jour un nœud
   */
  const updateNode = useCallback(
    async (nodeId: string, updates: Partial<V2WorkflowNode>) => {
      setState(s => ({ ...s, error: null }));
      try {
        const updated = await WorkflowNodeService.updateNode(
          nodeId,
          updates,
          persistenceOptions
        );
        setState(s => ({
          ...s,
          nodes: s.nodes.map(n => n.id === nodeId ? updated : n)
        }));
      } catch (err: any) {
        setState(s => ({
          ...s,
          error: err.message || 'Failed to update node'
        }));
        throw err;
      }
    },
    [isAuthenticated, accessToken]
  );

  /**
   * Supprimer un nœud
   */
  const deleteNode = useCallback(
    async (nodeId: string) => {
      setState(s => ({ ...s, error: null }));
      try {
        await WorkflowNodeService.deleteNode(nodeId, persistenceOptions);
        setState(s => ({
          ...s,
          nodes: s.nodes.filter(n => n.id !== nodeId)
        }));
      } catch (err: any) {
        setState(s => ({
          ...s,
          error: err.message || 'Failed to delete node'
        }));
        throw err;
      }
    },
    [isAuthenticated, accessToken]
  );

  /**
   * Ajouter une connexion (edge)
   */
  const addEdge = useCallback(
    async (source: string, target: string, workflowId: string): Promise<V2WorkflowEdge> => {
      setState(s => ({ ...s, error: null }));
      try {
        const edge = await WorkflowEdgeService.createEdge(
          { source, target } as Partial<V2WorkflowEdge>,
          persistenceOptions
        );
        setState(s => ({
          ...s,
          edges: [...s.edges, edge]
        }));
        return edge;
      } catch (err: any) {
        setState(s => ({
          ...s,
          error: err.message || 'Failed to add edge'
        }));
        throw err;
      }
    },
    [isAuthenticated, accessToken]
  );

  /**
   * Supprimer une connexion
   */
  const deleteEdge = useCallback(
    async (edgeId: string) => {
      setState(s => ({ ...s, error: null }));
      try {
        await WorkflowEdgeService.deleteEdge(edgeId, persistenceOptions);
        setState(s => ({
          ...s,
          edges: s.edges.filter(e => e.id !== edgeId)
        }));
      } catch (err: any) {
        setState(s => ({
          ...s,
          error: err.message || 'Failed to delete edge'
        }));
        throw err;
      }
    },
    [isAuthenticated, accessToken]
  );

  /**
   * Effacer le message d'erreur
   */
  const clearError = useCallback(() => {
    setState(s => ({ ...s, error: null }));
  }, []);

  /**
   * Charger les workflows au montage ou lors du changement d'authentification
   */
  useEffect(() => {
    if (!authLoading) {
      loadWorkflows();
    }
  }, [isAuthenticated, authLoading]);

  return {
    ...state,
    loadWorkflows,
    loadWorkflow,
    createWorkflow,
    updateWorkflow,
    deleteWorkflow,
    setActiveWorkflow,
    addNode,
    updateNode,
    deleteNode,
    addEdge,
    deleteEdge,
    clearError
  };
};

export default useWorkflowData;

/**
 * @file workflowService.ts
 * @description Service de gestion des workflows avec basculement intelligent API/localStorage
 * @domain Design Domain - Data Persistence
 *
 * Ce service implémente une couche d'abstraction pour:
 * - Workflows authentifiés → API backend (MongoDB)
 * - Workflows invités → localStorage
 *
 * PATTERN: Service Layer (Orchestration)
 * - Encapsule la logique de persistance
 * - Permet basculement transparent API/localStorage
 * - Prêt pour l'architecture V2 des robots
 */

import type { V2WorkflowNode, V2WorkflowEdge, Workflow } from '../types';
import { API_BASE_URL } from '../config/api.config';
const GUEST_WORKFLOW_KEY = 'guest_workflow_v1';
const GUEST_NODES_KEY = 'guest_workflow_nodes_v1';
const GUEST_EDGES_KEY = 'guest_workflow_edges_v1';

interface PersistenceOptions {
  token?: string | null;
  isAuthenticated?: boolean;
}

/**
 * Service: Workflows
 * Encapsule l'accès aux workflows avec basculement API/localStorage
 */
export const WorkflowService = {
  /**
   * Lister tous les workflows
   * - Mode authentifié: API GET /api/workflows
   * - Mode invité: localStorage
   */
  async getAllWorkflows(options: PersistenceOptions): Promise<Workflow[]> {
    if (options.isAuthenticated && options.token) {
      return this._fetchFromAPI('/api/workflows', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${options.token}`
        }
      });
    } else {
      return this._loadFromStorage(GUEST_WORKFLOW_KEY, []);
    }
  },

  /**
   * Récupérer un workflow spécifique
   */
  async getWorkflow(
    workflowId: string,
    options: PersistenceOptions
  ): Promise<Workflow | null> {
    if (options.isAuthenticated && options.token) {
      return this._fetchFromAPI(`/api/workflows/${workflowId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${options.token}`
        }
      });
    } else {
      const workflows = this._loadFromStorage(GUEST_WORKFLOW_KEY, []);
      return workflows.find((w: any) => w._id === workflowId) || null;
    }
  },

  /**
   * Créer un nouveau workflow
   */
  async createWorkflow(
    workflowData: Partial<Workflow>,
    options: PersistenceOptions
  ): Promise<Workflow> {
    if (options.isAuthenticated && options.token) {
      return this._fetchFromAPI('/api/workflows', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${options.token}`
        },
        body: JSON.stringify(workflowData)
      });
    } else {
      // Mode invité: générer un ID local
      const workflow: Workflow = {
        _id: `guest-workflow-${Date.now()}`,
        name: workflowData.name || 'New Workflow',
        description: workflowData.description,
        nodes: [],
        edges: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };
      this._saveToStorage(GUEST_WORKFLOW_KEY, [workflow]);
      return workflow;
    }
  },

  /**
   * Mettre à jour un workflow
   */
  async updateWorkflow(
    workflowId: string,
    updates: Partial<Workflow>,
    options: PersistenceOptions
  ): Promise<Workflow> {
    if (options.isAuthenticated && options.token) {
      return this._fetchFromAPI(`/api/workflows/${workflowId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${options.token}`
        },
        body: JSON.stringify(updates)
      });
    } else {
      // Mode invité: mettre à jour dans localStorage
      const workflows = this._loadFromStorage(GUEST_WORKFLOW_KEY, []);
      const index = workflows.findIndex((w: any) => w._id === workflowId);

      if (index === -1) {
        throw new Error('Workflow not found');
      }

      const updated = {
        ...workflows[index],
        ...updates,
        updatedAt: new Date()
      };

      workflows[index] = updated;
      this._saveToStorage(GUEST_WORKFLOW_KEY, workflows);
      return updated;
    }
  },

  /**
   * Supprimer un workflow
   */
  async deleteWorkflow(
    workflowId: string,
    options: PersistenceOptions
  ): Promise<void> {
    if (options.isAuthenticated && options.token) {
      await this._fetchFromAPI(`/api/workflows/${workflowId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${options.token}`
        }
      });
    } else {
      // Mode invité: supprimer de localStorage
      const workflows = this._loadFromStorage(GUEST_WORKFLOW_KEY, []);
      const filtered = workflows.filter((w: any) => w._id !== workflowId);
      this._saveToStorage(GUEST_WORKFLOW_KEY, filtered);
    }
  },

  /**
   * Activer/Désactiver un workflow
   */
  async setActiveWorkflow(
    workflowId: string,
    isActive: boolean,
    options: PersistenceOptions
  ): Promise<Workflow> {
    return this.updateWorkflow(
      workflowId,
      { isActive },
      options
    );
  },

  /**
   * Privé: Requête API générique
   */
  async _fetchFromAPI(
    endpoint: string,
    init: RequestInit
  ): Promise<any> {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init.headers
      }
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || `API request failed: ${response.status}`);
    }

    // Certains endpoints retournent vide (DELETE)
    if (response.status === 204) {
      return null;
    }

    return response.json();
  },

  /**
   * Privé: Charger depuis localStorage
   */
  _loadFromStorage(key: string, defaultValue: any): any {
    try {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : defaultValue;
    } catch (err) {
      console.error(`Failed to load from localStorage: ${key}`, err);
      return defaultValue;
    }
  },

  /**
   * Privé: Sauvegarder en localStorage
   */
  _saveToStorage(key: string, data: any): void {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (err) {
      console.error(`Failed to save to localStorage: ${key}`, err);
    }
  }
};

/**
 * Service: Nodes de workflow
 * Gestion des nœuds avec persistence transparente
 */
export const WorkflowNodeService = {
  async getNodesByWorkflow(
    workflowId: string,
    options: PersistenceOptions
  ): Promise<V2WorkflowNode[]> {
    if (options.isAuthenticated && options.token) {
      return WorkflowService._fetchFromAPI(
        `/api/workflows/${workflowId}/nodes`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${options.token}`
          }
        }
      );
    } else {
      const nodes = WorkflowService._loadFromStorage(GUEST_NODES_KEY, []);
      return nodes.filter((n: any) => n.workflowId === workflowId);
    }
  },

  async createNode(
    node: Partial<V2WorkflowNode>,
    options: PersistenceOptions
  ): Promise<V2WorkflowNode> {
    if (options.isAuthenticated && options.token) {
      return WorkflowService._fetchFromAPI('/api/nodes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${options.token}`
        },
        body: JSON.stringify(node)
      });
    } else {
      const nodes = WorkflowService._loadFromStorage(GUEST_NODES_KEY, []) as V2WorkflowNode[];
      // Construire un V2WorkflowNode valid avec les données fournies
      const newNode: V2WorkflowNode = {
        id: `node-${Date.now()}`,
        type: (node as any).type || 'agent',
        position: (node as any).position || { x: 0, y: 0 },
        data: {
          robotId: (node as any).robotId || (node as any).data?.robotId || 'Archi',
          label: (node as any).label || (node as any).data?.label || 'New Node',
          isMinimized: (node as any).data?.isMinimized,
          isMaximized: (node as any).data?.isMaximized
        }
      };
      nodes.push(newNode);
      WorkflowService._saveToStorage(GUEST_NODES_KEY, nodes);
      return newNode;
    }
  },

  async updateNode(
    nodeId: string,
    updates: Partial<V2WorkflowNode>,
    options: PersistenceOptions
  ): Promise<V2WorkflowNode> {
    if (options.isAuthenticated && options.token) {
      return WorkflowService._fetchFromAPI(`/api/nodes/${nodeId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${options.token}`
        },
        body: JSON.stringify(updates)
      });
    } else {
      const nodes = WorkflowService._loadFromStorage(GUEST_NODES_KEY, []);
      const index = nodes.findIndex((n: any) => n._id === nodeId);
      if (index === -1) throw new Error('Node not found');

      const updated = { ...nodes[index], ...updates, updatedAt: new Date() };
      nodes[index] = updated;
      WorkflowService._saveToStorage(GUEST_NODES_KEY, nodes);
      return updated;
    }
  },

  async deleteNode(
    nodeId: string,
    options: PersistenceOptions
  ): Promise<void> {
    if (options.isAuthenticated && options.token) {
      await WorkflowService._fetchFromAPI(`/api/nodes/${nodeId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${options.token}`
        }
      });
    } else {
      const nodes = WorkflowService._loadFromStorage(GUEST_NODES_KEY, []);
      const filtered = nodes.filter((n: any) => n._id !== nodeId);
      WorkflowService._saveToStorage(GUEST_NODES_KEY, filtered);
    }
  }
};

/**
 * Service: Edges (Connexions entre nœuds)
 */
export const WorkflowEdgeService = {
  async getEdgesByWorkflow(
    workflowId: string,
    options: PersistenceOptions
  ): Promise<V2WorkflowEdge[]> {
    if (options.isAuthenticated && options.token) {
      return WorkflowService._fetchFromAPI(
        `/api/workflows/${workflowId}/edges`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${options.token}`
          }
        }
      );
    } else {
      const edges = WorkflowService._loadFromStorage(GUEST_EDGES_KEY, []);
      return edges.filter((e: any) => e.workflowId === workflowId);
    }
  },

  async createEdge(
    edge: Partial<V2WorkflowEdge>,
    options: PersistenceOptions
  ): Promise<V2WorkflowEdge> {
    if (options.isAuthenticated && options.token) {
      return WorkflowService._fetchFromAPI('/api/edges', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${options.token}`
        },
        body: JSON.stringify(edge)
      });
    } else {
      const edges = WorkflowService._loadFromStorage(GUEST_EDGES_KEY, []) as V2WorkflowEdge[];
      // Construire un V2WorkflowEdge valid
      const newEdge: V2WorkflowEdge = {
        id: `edge-${Date.now()}`,
        source: (edge as any).source || '',
        target: (edge as any).target || '',
        type: (edge as any).type || 'default',
        data: (edge as any).data
      };
      edges.push(newEdge);
      WorkflowService._saveToStorage(GUEST_EDGES_KEY, edges);
      return newEdge;
    }
  },

  async deleteEdge(
    edgeId: string,
    options: PersistenceOptions
  ): Promise<void> {
    if (options.isAuthenticated && options.token) {
      await WorkflowService._fetchFromAPI(`/api/edges/${edgeId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${options.token}`
        }
      });
    } else {
      const edges = WorkflowService._loadFromStorage(GUEST_EDGES_KEY, []);
      const filtered = edges.filter((e: any) => e._id !== edgeId);
      WorkflowService._saveToStorage(GUEST_EDGES_KEY, filtered);
    }
  }
};

export default {
  WorkflowService,
  WorkflowNodeService,
  WorkflowEdgeService
};

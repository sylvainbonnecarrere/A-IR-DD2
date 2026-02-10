import { create } from 'zustand';
import { Agent, V2WorkflowNode, V2WorkflowEdge, RobotId, AgentInstance, ResolvedAgentInstance } from '../types';
import { GovernanceService } from '../services/governanceService';

/**
 * Design Domain Store - Gère les prototypes et définitions statiques
 * Responsabilité : CRUD des agents, configuration des workflows, 
 * données persistantes et sérialisables
 * 
 * PHASE 1A: Séparation Prototype vs Instance
 */
interface DesignStore {
  // Current robot context for governance
  currentRobotId: RobotId;

  // Agents (prototypes)
  agents: Agent[];
  selectedAgentId: string | null;

  // Agent Instances (instances des prototypes dans les workflows)
  agentInstances: AgentInstance[];

  // V2 Workflow Design
  nodes: V2WorkflowNode[];
  edges: V2WorkflowEdge[];

  // Actions - Robot Context
  setCurrentRobot: (robotId: RobotId) => void;

  // Actions - Agents (Prototypes) with Governance
  addAgent: (agent: Omit<Agent, 'id' | 'creator_id' | 'created_at' | 'updated_at'>) => { success: boolean; error?: string; agentId?: string };
  updateAgent: (id: string, agent: Partial<Agent>) => { success: boolean; error?: string };
  updateAgentId: (tempId: string, realObjectId: string) => { success: boolean; error?: string };
  deleteAgent: (id: string, options?: { deleteInstances?: boolean }) => { success: boolean; error?: string };
  selectAgent: (id: string | null) => void;

  // Actions - Agent Instances  
  addAgentInstance: (prototypeId: string, position: { x: number; y: number }, name?: string, workflowId?: string) => string;
  updateAgentInstance: (id: string, updates: Partial<AgentInstance>) => void;
  updateInstanceId: (tempId: string, realId: string) => void;
  updateInstanceConfig: (id: string, configUpdates: Partial<AgentInstance['configuration_json']>) => void;
  deleteAgentInstance: (id: string) => void;
  getResolvedInstance: (instanceId: string) => ResolvedAgentInstance | undefined;
  getInstancesOfPrototype: (prototypeId: string) => AgentInstance[];
  getInstanceCount: (prototypeId: string) => number;

  // PHASE 1B: Orphan detection and cleanup
  detectOrphanedInstances: () => AgentInstance[];
  cleanupOrphanedInstances: () => number;
  validateWorkflowIntegrity: () => { orphanedNodes: V2WorkflowNode[]; fixedCount: number };
  getDiagnostics: () => {
    prototypes: number;
    instances: number;
    nodes: number;
    orphanedInstances: number;
    integrity: string
  };
  getPrototypeImpact: (prototypeId: string) => {
    instanceCount: number;
    nodeCount: number;
    instances: AgentInstance[];
    nodes: V2WorkflowNode[];
  };

  // Actions - Workflow Design  
  addNode: (node: Omit<V2WorkflowNode, 'id'>) => void;
  updateNode: (id: string, updates: Partial<V2WorkflowNode>) => void;
  deleteNode: (id: string) => void;
  addEdge: (edge: Omit<V2WorkflowEdge, 'id'>) => void;
  deleteEdge: (id: string) => void;

  // Utility
  getAgentsByRobot: (robotId: RobotId) => Agent[];
  clearWorkflow: () => void;
  
  // ⭐ ÉTAPE 2.2-2.3: Reset & Hydration
  resetAll: () => void;
  hydrateFromServer: (data: {
    agents?: Agent[];
    agentInstances?: AgentInstance[];
    nodes?: V2WorkflowNode[];
    edges?: V2WorkflowEdge[];
  }) => void;
  
  // ⭐ Direct setters for testing and hydration
  setAgents: (agents: Agent[]) => void;
  setAgentInstances: (instances: AgentInstance[]) => void;
  setNodes: (nodes: V2WorkflowNode[]) => void;
  setEdges: (edges: V2WorkflowEdge[]) => void;
}

export const useDesignStore = create<DesignStore>((set, get) => ({
  // Initial state with governance
  currentRobotId: RobotId.Archi, // Default to Archi for agent creation
  agents: [],
  selectedAgentId: null,
  agentInstances: [],
  nodes: [],
  edges: [],

  // Robot context actions
  setCurrentRobot: (robotId) => set({ currentRobotId: robotId }),

  // Agent actions with governance
  addAgent: (agentData) => {
    const state = get();
    const currentTime = new Date().toISOString();

    // Create full agent object with governance metadata
    const fullAgent: Agent = {
      ...agentData,
      id: `agent-${Date.now()}`,
      creator_id: state.currentRobotId,
      created_at: currentTime,
      updated_at: currentTime
    };

    // Validate governance
    const validation = GovernanceService.enforceGovernance(
      fullAgent,
      'agent',
      'create',
      state.currentRobotId
    );

    if (!validation.success) {
      return {
        success: false,
        error: validation.error
      };
    }

    // Add agent if validation passes
    set((state) => ({
      agents: [...state.agents, fullAgent]
    }));

    return {
      success: true,
      agentId: fullAgent.id
    };
  },

  updateAgent: (id, updates) => {
    const state = get();

    // Governance validation
    const validation = GovernanceService.enforceGovernance(
      { creator_id: state.currentRobotId } as any,
      'agent',
      'modify',
      state.currentRobotId
    );

    if (!validation.success) {
      return {
        success: false,
        error: validation.error
      };
    }

    set((state) => {
      // Add updated_at timestamp for modifications
      const updatesWithTimestamp = {
        ...updates,
        updated_at: new Date().toISOString()
      };

      // PRINCIPE DE NON-AFFECTATION STRICT:
      // Seule la définition du prototype est modifiée.
      // Les instances existantes conservent TOUTES leurs configurations actuelles.
      // Seules les FUTURES instances créées après cette modification utiliseront la nouvelle définition.

      const updatedAgents = state.agents.map(agent =>
        agent.id === id ? { ...agent, ...updatesWithTimestamp } : agent
      );

      // NE PAS MODIFIER les instances existantes - elles restent inchangées
      // Ceci garantit que les agents déployés conservent leurs configurations personnalisées

      return {
        agents: updatedAgents,
        // agentInstances: INCHANGÉS - principe de non-affectation
        // nodes: INCHANGÉS - principe de non-affectation
      };
    });

    return { success: true };
  },

  /**
   * Replace temporary agent ID (created locally) with real ObjectId from backend
   * Called after successful API creation of AgentPrototype
   */
  updateAgentId: (tempId, realObjectId) => {
    const state = get();

    // Find agent with tempId
    const agentToUpdate = state.agents.find(a => a.id === tempId);
    if (!agentToUpdate) {
      return {
        success: false,
        error: `Agent avec ID temporaire "${tempId}" non trouvé`
      };
    }

    // Update agent ID in agents array
    set((state) => ({
      agents: state.agents.map(agent =>
        agent.id === tempId ? { ...agent, id: realObjectId } : agent
      ),
      // Update all instances that reference this prototype
      agentInstances: state.agentInstances.map(instance =>
        instance.prototypeId === tempId ? { ...instance, prototypeId: realObjectId } : instance
      ),
      // Update selected agent if it's the one being updated
      selectedAgentId: state.selectedAgentId === tempId ? realObjectId : state.selectedAgentId,
      // Note: V2WorkflowNodes reference agents via data.agent.id, but those are local state nodes
      // They should automatically use the updated agent object
    }));

    console.log(`[useDesignStore] ✅ Updated agent ID: "${tempId}" → "${realObjectId}"`);
    return { success: true };
  },

  deleteAgent: (id, options = { deleteInstances: true }) => {
    const state = get();

    // Governance validation
    const validation = GovernanceService.enforceGovernance(
      { creator_id: state.currentRobotId } as any,
      'agent',
      'delete',
      state.currentRobotId
    );

    if (!validation.success) {
      return {
        success: false,
        error: validation.error
      };
    }

    if (options.deleteInstances) {
      // Suppression complète : prototype + instances + nodes
      const instancesToDelete = state.agentInstances
        .filter(instance => instance.prototypeId === id)
        .map(instance => instance.id);

      // Identify nodes to delete (nodes with instances belonging to this prototype)
      const nodesToDelete = state.nodes
        .filter(node => {
          const instanceId = node.data.agentInstance?.id;
          return instanceId && instancesToDelete.includes(instanceId);
        })
        .map(node => node.id);

      set((state) => ({
        agents: state.agents.filter(agent => agent.id !== id),
        selectedAgentId: state.selectedAgentId === id ? null : state.selectedAgentId,
        // Remove related instances
        agentInstances: state.agentInstances.filter(instance => instance.prototypeId !== id),
        // Remove related nodes
        nodes: state.nodes.filter(node => !nodesToDelete.includes(node.id)),
        // Remove related edges (edges connected to deleted nodes)
        edges: state.edges.filter(edge =>
          !nodesToDelete.includes(edge.source) && !nodesToDelete.includes(edge.target)
        )
      }));
    } else {
      // Suppression du prototype uniquement : les instances deviennent orphelines
      set((state) => ({
        agents: state.agents.filter(agent => agent.id !== id),
        selectedAgentId: state.selectedAgentId === id ? null : state.selectedAgentId,
        // Ne PAS supprimer les instances ni les nodes - ils restent orphelins
      }));
    }

    // PHASE 1B: Additional integrity validation after deletion
    setTimeout(() => {
      const { fixedCount } = get().validateWorkflowIntegrity();
      if (fixedCount > 0) {
        console.log(`🔧 Post-deletion cleanup: fixed ${fixedCount} additional orphaned nodes`);
      }
    }, 0);

    return { success: true };
  },

  selectAgent: (id) => set({ selectedAgentId: id }),

  // Agent Instance actions
  addAgentInstance: (prototypeId, position, name, workflowId) => {
    const prototype = get().agents.find(a => a.id === prototypeId);
    if (!prototype) throw new Error(`Prototype ${prototypeId} not found`);

    const instanceId = `instance-${Date.now()}`;

    // 🔥 CLONAGE PROFOND : Configuration indépendante du prototype
    const configuration_json = {
      role: prototype.role,
      model: prototype.model,
      llmProvider: prototype.llmProvider,
      systemPrompt: prototype.systemPrompt,
      tools: JSON.parse(JSON.stringify(prototype.tools || [])), // Deep clone
      outputConfig: prototype.outputConfig ? JSON.parse(JSON.stringify(prototype.outputConfig)) : undefined,
      capabilities: prototype.capabilities ? [...prototype.capabilities] : undefined,
      historyConfig: prototype.historyConfig ? JSON.parse(JSON.stringify(prototype.historyConfig)) : undefined,
      position,
      // Sections futures
      links: [],
      tasks: [],
      logs: [],
      errors: []
    };

    const instance: AgentInstance = {
      id: instanceId,
      prototypeId,
      workflowId, // ⭐ NOUVEAU: Stocker workflowId pour persistance journal
      name: name || prototype.name,
      position,
      isMinimized: false,
      isMaximized: false,
      configuration_json // ✅ Configuration clonée et isolée
    };

    set((state) => ({
      agentInstances: [...state.agentInstances, instance]
    }));

    return instanceId;
  },

  updateAgentInstance: (id, updates) => set((state) => ({
    agentInstances: state.agentInstances.map(instance =>
      instance.id === id ? { ...instance, ...updates } : instance
    )
  })),

  /**
   * Replace temporary instance ID (created locally) with real ID from backend
   * Called after successful API creation of AgentInstance
   * 
   * ⭐ ÉTAPE 1 FIX: Also renames the node ID from 'node-tempId' to 'node-realId'
   * This ensures node.id matches instance.id, fixing "Instance non trouvée" errors
   */
  updateInstanceId: (tempId, realId) => set((state) => ({
    agentInstances: state.agentInstances.map(instance =>
      instance.id === tempId ? { ...instance, id: realId } : instance
    ),
    // ⭐ CRITICAL: Update nodes that reference this instance
    // Both rename the node ID itself AND update the instance reference inside
    nodes: state.nodes.map(node => {
      // Check if node references this instance (by old tempId)
      if (node.data.agentInstance?.id === tempId) {
        return {
          ...node,
          // ⭐ ÉTAPE 1 FIX: Rename the node ID itself from 'node-tempId' to 'node-realId'
          id: `node-${realId}`,
          data: {
            ...node.data,
            agentInstance: {
              ...node.data.agentInstance,
              id: realId  // Also update the instance reference inside
            }
          }
        };
      }
      return node;
    })
  })),

  updateInstanceConfig: (id, configUpdates) => set((state) => ({
    agentInstances: state.agentInstances.map(instance => {
      if (instance.id !== id) return instance;

      // Fusionner les mises à jour avec la configuration existante
      const updatedConfig = instance.configuration_json
        ? { ...instance.configuration_json, ...configUpdates }
        : configUpdates;

      return { ...instance, configuration_json: updatedConfig as any };
    })
  })),

  deleteAgentInstance: (id) => set((state) => {
    // Find nodes to delete (nodes with this instance)
    const nodesToDelete = state.nodes
      .filter(node => node.data.agentInstance?.id === id)
      .map(node => node.id);

    return {
      agentInstances: state.agentInstances.filter(instance => instance.id !== id),
      nodes: state.nodes.filter(node => node.data.agentInstance?.id !== id),
      // Also delete edges connected to these nodes
      edges: state.edges.filter(edge =>
        !nodesToDelete.includes(edge.source) && !nodesToDelete.includes(edge.target)
      )
    };
  }),

  getResolvedInstance: (instanceId) => {
    const state = get();
    const instance = state.agentInstances.find(i => i.id === instanceId);
    if (!instance) return null;

    const prototype = state.agents.find(a => a.id === instance.prototypeId);
    if (!prototype) return null;

    return { instance, prototype };
  },

  getInstancesOfPrototype: (prototypeId) => {
    // Return all instances of this prototype (they should match nodes 1:1 if cleanup is correct)
    return get().agentInstances.filter(instance => instance.prototypeId === prototypeId);
  },

  getInstanceCount: (prototypeId) => {
    // Use the same logic as getInstancesOfPrototype to count only deployed instances
    return get().getInstancesOfPrototype(prototypeId).length;
  },

  // PHASE 1B: Orphan detection and cleanup
  detectOrphanedInstances: () => {
    const { agentInstances, agents } = get();
    const existingPrototypeIds = new Set(agents.map(agent => agent.id));

    return agentInstances.filter(instance => !existingPrototypeIds.has(instance.prototypeId));
  },

  cleanupOrphanedInstances: () => {
    const orphanedInstances = get().detectOrphanedInstances();
    const orphanedIds = orphanedInstances.map(instance => instance.id);

    if (orphanedIds.length > 0) {
      set(state => ({
        agentInstances: state.agentInstances.filter(instance => !orphanedIds.includes(instance.id))
      }));

      console.log(`🧹 Cleaned up ${orphanedIds.length} orphaned instances:`, orphanedIds);
    }

    return orphanedIds.length;
  },

  validateWorkflowIntegrity: () => {
    const { nodes, agentInstances } = get();
    const existingInstanceIds = new Set(agentInstances.map(instance => instance.id));

    // Find workflow nodes with missing agent instances
    const orphanedNodes = nodes.filter(node =>
      node.data.agentInstance && !existingInstanceIds.has(node.data.agentInstance.id)
    );

    // Auto-fix by removing orphaned nodes
    if (orphanedNodes.length > 0) {
      const orphanedNodeIds = orphanedNodes.map(node => node.id);
      set(state => ({
        nodes: state.nodes.filter(node => !orphanedNodeIds.includes(node.id)),
        edges: state.edges.filter(edge =>
          !orphanedNodeIds.includes(edge.source) && !orphanedNodeIds.includes(edge.target)
        )
      }));

      console.log(`🔧 Fixed ${orphanedNodes.length} orphaned workflow nodes:`, orphanedNodeIds);
    }

    return { orphanedNodes, fixedCount: orphanedNodes.length };
  },

  getDiagnostics: () => {
    const { agents, agentInstances, nodes } = get();
    const orphanedInstances = get().detectOrphanedInstances();
    const agentInstanceNodes = nodes.filter(node => node.data.agentInstance);

    return {
      prototypes: agents.length,
      instances: agentInstances.length,
      nodes: nodes.length,
      orphanedInstances: orphanedInstances.length,
      integrity: orphanedInstances.length === 0 && agentInstanceNodes.length === agentInstances.length
        ? 'OK'
        : `${orphanedInstances.length} orphaned instances, ${agentInstanceNodes.length}/${agentInstances.length} instances in workflow`
    };
  },

  getPrototypeImpact: (prototypeId) => {
    const state = get();

    // 1. Trouver les nodes actuellement déployés pour ce prototype
    const affectedNodes = state.nodes.filter(node =>
      node.data.agentInstance?.prototypeId === prototypeId
    );

    // 2. Extraire les IDs des instances actuellement déployées
    const deployedInstanceIds = new Set(
      affectedNodes.map(node => node.data.agentInstance?.id).filter(Boolean) as string[]
    );

    // 3. Ne compter que les instances qui sont effectivement déployées sur le workflow
    const affectedInstances = state.agentInstances.filter(instance =>
      instance.prototypeId === prototypeId && deployedInstanceIds.has(instance.id)
    );

    return {
      instanceCount: affectedInstances.length, // Nombre réel d'instances déployées
      nodeCount: affectedNodes.length,
      instances: affectedInstances,
      nodes: affectedNodes
    };
  },

  // Workflow design actions
  addNode: (nodeData) => set((state) => ({
    nodes: [...state.nodes, { ...nodeData, id: `node-${Date.now()}` }]
  })),

  updateNode: (id, updates) => set((state) => ({
    nodes: state.nodes.map(node =>
      node.id === id ? { ...node, ...updates } : node
    )
  })),

  deleteNode: (id) => set((state) => {
    // Find the node being deleted to get its instance ID
    const nodeToDelete = state.nodes.find(node => node.id === id);
    const instanceId = nodeToDelete?.data.agentInstance?.id;

    return {
      nodes: state.nodes.filter(node => node.id !== id),
      edges: state.edges.filter(edge => edge.source !== id && edge.target !== id),
      // CRITICAL: Also delete the associated agentInstance to maintain consistency
      agentInstances: instanceId
        ? state.agentInstances.filter(instance => instance.id !== instanceId)
        : state.agentInstances
    };
  }),

  addEdge: (edgeData) => set((state) => ({
    edges: [...state.edges, { ...edgeData, id: `edge-${Date.now()}` }]
  })),

  deleteEdge: (id) => set((state) => ({
    edges: state.edges.filter(edge => edge.id !== id)
  })),

  // Utility functions
  getAgentsByRobot: (robotId) => {
    const state = get();
    // TODO: Implement robot-specific filtering logic
    return state.agents;
  },

  clearWorkflow: () => set({
    nodes: [],
    edges: []
  }),

  /**
   * ⭐ ÉTAPE 2.2: Reset complet du store pour wipe à la connexion
   * Appelé lors du login/logout pour éviter la fuite de données guest → auth
   */
  resetAll: () => set({
    currentRobotId: RobotId.Archi,
    agents: [],
    selectedAgentId: null,
    agentInstances: [],
    nodes: [],
    edges: []
  }),

  /**
   * ⭐ ÉTAPE 2.3: Hydratation du store depuis les données serveur
   * Appelé après fetch /api/user/workspace
   */
  hydrateFromServer: (data: {
    agents?: Agent[];
    agentInstances?: AgentInstance[];
    nodes?: V2WorkflowNode[];
    edges?: V2WorkflowEdge[];
  }) => set({
    agents: data.agents || [],
    agentInstances: data.agentInstances || [],
    nodes: data.nodes || [],
    edges: data.edges || []
  }),

  /**
   * ⭐ Direct setters for testing and hydration
   */
  setAgents: (agents) => set({ agents }),
  setAgentInstances: (instances) => set({ agentInstances: instances }),
  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges })
}));

// PHASE 1B: Development debugging exposure
if (typeof window !== 'undefined') {
  (window as any).__DESIGN_STORE__ = useDesignStore;
}
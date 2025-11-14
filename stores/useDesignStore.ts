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
  deleteAgent: (id: string, options?: { deleteInstances?: boolean }) => { success: boolean; error?: string };
  selectAgent: (id: string | null) => void;

  // Actions - Agent Instances  
  addAgentInstance: (prototypeId: string, position: { x: number; y: number }, name?: string) => string;
  updateAgentInstance: (id: string, updates: Partial<AgentInstance>) => void;
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

      // Update the prototype
      const updatedAgents = state.agents.map(agent =>
        agent.id === id ? { ...agent, ...updatesWithTimestamp } : agent
      );

      // Find all instances that reference this prototype
      const updatedInstances = state.agentInstances.map(instance => {
        if (instance.prototypeId === id) {
          // For now, only update the name if it matches the prototype name
          // Keep instance-specific customizations
          const prototype = state.agents.find(a => a.id === id);
          const shouldUpdateName = prototype && instance.name === prototype.name;

          return {
            ...instance,
            // Only update name if the instance name matches the original prototype name
            ...(updatesWithTimestamp.name && shouldUpdateName && { name: updatesWithTimestamp.name })
          };
        }
        return instance;
      });

      // Update workflow nodes that contain these instances
      const updatedNodes = state.nodes.map(node => {
        if (node.data.agentInstance && node.data.agentInstance.prototypeId === id) {
          // Find the updated instance
          const updatedInstance = updatedInstances.find(inst => inst.id === node.data.agentInstance?.id);
          if (updatedInstance) {
            return {
              ...node,
              data: {
                ...node.data,
                agentInstance: updatedInstance
              }
            };
          }
        }
        return node;
      });

      return {
        agents: updatedAgents,
        agentInstances: updatedInstances,
        nodes: updatedNodes
      };
    });

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
      set((state) => ({
        agents: state.agents.filter(agent => agent.id !== id),
        selectedAgentId: state.selectedAgentId === id ? null : state.selectedAgentId,
        // Remove related instances
        agentInstances: state.agentInstances.filter(instance => instance.prototypeId !== id),
        // Remove related nodes
        nodes: state.nodes.filter(node => node.data.agentInstance?.prototypeId !== id)
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
  addAgentInstance: (prototypeId, position, name) => {
    const prototype = get().agents.find(a => a.id === prototypeId);
    if (!prototype) throw new Error(`Prototype ${prototypeId} not found`);

    const instanceId = `instance-${Date.now()}`;
    const instance: AgentInstance = {
      id: instanceId,
      prototypeId,
      name: name || prototype.name,
      position,
      isMinimized: false
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

  deleteAgentInstance: (id) => set((state) => ({
    agentInstances: state.agentInstances.filter(instance => instance.id !== id),
    nodes: state.nodes.filter(node => node.data.agentInstance?.id !== id)
  })),

  getResolvedInstance: (instanceId) => {
    const state = get();
    const instance = state.agentInstances.find(i => i.id === instanceId);
    if (!instance) return null;

    const prototype = state.agents.find(a => a.id === instance.prototypeId);
    if (!prototype) return null;

    return { instance, prototype };
  },

  getInstancesOfPrototype: (prototypeId) => {
    return get().agentInstances.filter(instance => instance.prototypeId === prototypeId);
  },

  getInstanceCount: (prototypeId) => {
    return get().agentInstances.filter(instance => instance.prototypeId === prototypeId).length;
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
    const affectedInstances = state.agentInstances.filter(instance =>
      instance.prototypeId === prototypeId
    );
    const affectedNodes = state.nodes.filter(node =>
      node.data.agentInstance?.prototypeId === prototypeId
    );

    return {
      instanceCount: affectedInstances.length,
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

  deleteNode: (id) => set((state) => ({
    nodes: state.nodes.filter(node => node.id !== id),
    edges: state.edges.filter(edge => edge.source !== id && edge.target !== id)
  })),

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
  })
}));

// PHASE 1B: Development debugging exposure
if (typeof window !== 'undefined') {
  (window as any).__DESIGN_STORE__ = useDesignStore;
}
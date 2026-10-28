/**
 * @file workspacePersistenceService.ts
 * @description Unified persistence service for workspace data
 * @domain Design Domain - Data Persistence Strategy
 * 
 * ARCHITECTURE:
 * - Strategy Pattern: localStorage vs API based on auth state
 * - Single interface for all persistence operations
 * - Automatic backend selection
 * 
 * SOLID PRINCIPLES:
 * - S: Single responsibility (persistence operations only)
 * - O: Open for extension (add new entity types)
 * - L: Liskov substitution (same interface for both backends)
 * - I: Interface segregation (minimal method signatures)
 * - D: Dependency inversion (abstracts storage details)
 * 
 * NON-RÉGRESSION:
 * - Guest mode: localStorage unchanged
 * - Auth mode: API calls with proper headers
 */

import { GUEST_STORAGE_KEYS } from '../utils/guestDataUtils';
import { API_BASE_URL } from '../config/api.config';
import { buildGovernanceHeaders } from '../utils/governanceHeaders';

/**
 * Persistence options for all operations
 */
export interface PersistenceOptions {
    isAuthenticated: boolean;
    accessToken?: string | null;
}

/**
 * Workflow data structure for persistence
 */
export interface WorkflowPersistData {
    id?: string;
    name: string;
    description?: string;
    isActive?: boolean;
}

/**
 * Node data structure for persistence
 */
export interface NodePersistData {
    id: string;
    agentId: string;
    position: { x: number; y: number };
    data?: Record<string, any>;
}

/**
 * Edge data structure for persistence
 */
export interface EdgePersistData {
    id: string;
    sourceId: string;
    targetId: string;
    type?: string;
}

/**
 * WorkspacePersistenceService
 * Unified service for all workspace persistence operations
 */
export const WorkspacePersistenceService = {
    /**
     * Save workflow metadata
     */
    async saveWorkflow(
        workflow: WorkflowPersistData,
        options: PersistenceOptions
    ): Promise<{ id: string; success: boolean }> {
        if (!options.isAuthenticated) {
            // Guest mode: localStorage
            const existing = localStorage.getItem(GUEST_STORAGE_KEYS.WORKFLOW);
            const current = existing ? JSON.parse(existing) : {};
            
            const updated = {
                ...current,
                ...workflow,
                id: workflow.id || current.id || `guest_workflow_${Date.now()}`,
                updatedAt: new Date().toISOString()
            };
            
            localStorage.setItem(GUEST_STORAGE_KEYS.WORKFLOW, JSON.stringify(updated));
            console.log('[WorkspacePersistence] Saved workflow to localStorage');
            
            return { id: updated.id, success: true };
        }

        // Auth mode: API
        const url = workflow.id 
            ? `${API_BASE_URL}/api/workflows/${workflow.id}`
            : `${API_BASE_URL}/api/workflows`;
        
        const method = workflow.id ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${options.accessToken}`
            },
            body: JSON.stringify(workflow)
        });

        if (!response.ok) {
            throw new Error(`Failed to save workflow: ${response.statusText}`);
        }

        const saved = await response.json();
        console.log('[WorkspacePersistence] Saved workflow to API:', saved._id || saved.id);
        
        return { id: saved._id || saved.id, success: true };
    },

    /**
     * Save workflow nodes (batch)
     */
    async saveNodes(
        workflowId: string,
        nodes: NodePersistData[],
        options: PersistenceOptions
    ): Promise<{ success: boolean }> {
        if (!options.isAuthenticated) {
            // Guest mode: localStorage
            localStorage.setItem(GUEST_STORAGE_KEYS.WORKFLOW_NODES, JSON.stringify(nodes));
            console.log('[WorkspacePersistence] Saved nodes to localStorage:', nodes.length);
            return { success: true };
        }

        // Canonical V2 path: node positions are persisted on WorkflowNodeV2 records,
        // not on the legacy agent instance route. This preserves the V2 contract and
        // prevents hybrid workflow writes while allowing optimistic canvas updates.
        const promises = nodes.map(async (node) => {
            const response = await fetch(`${API_BASE_URL}/api/workflows/${workflowId}/v2/nodes/${node.id}`, {
                method: 'PATCH',
                headers: buildGovernanceHeaders(options.accessToken, {
                    'Content-Type': 'application/json'
                }),
                body: JSON.stringify({ position: node.position })
            });

            if (!response.ok) {
                throw new Error(`Failed to save workflow node ${node.id}: ${response.statusText}`);
            }

            return response;
        });

        await Promise.all(promises);
        console.log('[WorkspacePersistence] Saved nodes to API V2:', nodes.length);
        
        return { success: true };
    },

    /**
     * Save workflow edges (batch)
     */
    async saveEdges(
        workflowId: string,
        edges: EdgePersistData[],
        options: PersistenceOptions
    ): Promise<{ success: boolean }> {
        if (!options.isAuthenticated) {
            // Guest mode: localStorage
            localStorage.setItem(GUEST_STORAGE_KEYS.WORKFLOW_EDGES, JSON.stringify(edges));
            console.log('[WorkspacePersistence] Saved edges to localStorage:', edges.length);
            return { success: true };
        }

        // Cutover V2 gate: legacy workflow edge writes are explicitly forbidden.
        // The canonical edge persistence is handled by WorkflowEdgeV2 records and
        // should be routed through the V2 graph APIs, not the deprecated Workflow.edges[] path.
        throw new Error(
            'Deprecated workflow V1 edge mutation is forbidden. Use the canonical V2 graph APIs for workflow edge persistence.'
        );
    },

    /**
     * Save complete workspace state (atomic)
     */
    async saveWorkspaceState(
        workflow: WorkflowPersistData,
        nodes: NodePersistData[],
        edges: EdgePersistData[],
        options: PersistenceOptions
    ): Promise<{ workflowId: string; success: boolean }> {
        // Save workflow first to get ID
        const { id: workflowId } = await this.saveWorkflow(workflow, options);

        // Canonical V2 contract: node positions are persisted through the V2 node route.
        // Edge mutations are intentionally not reintroduced on the deprecated Workflow.edges[] path.
        await this.saveNodes(workflowId, nodes, options);

        if (!options.isAuthenticated) {
            localStorage.setItem(GUEST_STORAGE_KEYS.WORKFLOW_EDGES, JSON.stringify(edges));
        }

        console.log('[WorkspacePersistence] Complete workspace saved:', workflowId);
        return { workflowId, success: true };
    },

    /**
     * Delete workflow (cascade)
     */
    async deleteWorkflow(
        workflowId: string,
        options: PersistenceOptions
    ): Promise<{ success: boolean }> {
        if (!options.isAuthenticated) {
            // Guest mode: Clear all localStorage
            localStorage.removeItem(GUEST_STORAGE_KEYS.WORKFLOW);
            localStorage.removeItem(GUEST_STORAGE_KEYS.WORKFLOW_NODES);
            localStorage.removeItem(GUEST_STORAGE_KEYS.WORKFLOW_EDGES);
            console.log('[WorkspacePersistence] Deleted workflow from localStorage');
            return { success: true };
        }

        // Auth mode: API (cascade delete handled by backend)
        const response = await fetch(`${API_BASE_URL}/api/workflows/${workflowId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${options.accessToken}`
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to delete workflow: ${response.statusText}`);
        }

        console.log('[WorkspacePersistence] Deleted workflow from API:', workflowId);
        return { success: true };
    },

    /**
     * Mark workflow as dirty (unsaved changes)
     */
    markDirty(
        workflowId: string,
        options: PersistenceOptions
    ): void {
        if (!options.isAuthenticated) {
            // Guest mode: Update localStorage flag
            const existing = localStorage.getItem(GUEST_STORAGE_KEYS.WORKFLOW);
            if (existing) {
                const workflow = JSON.parse(existing);
                workflow.isDirty = true;
                localStorage.setItem(GUEST_STORAGE_KEYS.WORKFLOW, JSON.stringify(workflow));
            }
            return;
        }

        // Auth mode: Could debounce API call or use local state
        // For now, this is handled by the workflow reducer
        console.log('[WorkspacePersistence] Marked workflow dirty:', workflowId);
    }
};

export default WorkspacePersistenceService;

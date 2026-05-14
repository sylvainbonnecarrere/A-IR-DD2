/**
 * @file persistenceService.ts
 * @description Service unifié pour la persistance des workflows et agents
 * @domain Design Domain - Persistence Layer
 * 
 * ⭐ ÉTAPE 2.4: Sauvegarde unifiée (Guest vs Authenticated)
 * 
 * ARCHITECTURE:
 * - Dual-mode: localStorage pour guest, API pour authenticated
 * - Auto-save pour agents et instances (immédiat)
 * - Manual save pour workflow structure (bouton 💾)
 * 
 * ENDPOINTS UTILISÉS:
 * - PUT /api/workflows/:id - Save workflow (structure + canvasState)
 * - PUT /api/agent-instances/:id - Save agent instance (auto-save)
 * - POST /api/agent-instances/:id/content - Add content (chat/image/video/error)
 * 
 * SOLID PRINCIPLES:
 * - S: Single responsibility (persistence only)
 * - O: Open for extension (add new entity types)
 * - D: Dependency inversion (abstracts storage backend)
 */

import { GUEST_STORAGE_KEYS } from '../utils/guestDataUtils';
import { PersistenceConfig, normalizeMediaStorageType, normalizePersistenceConfig, summarizePersistenceConfig } from '../types';
import { API_BASE_URL } from '../config/api.config';
import { buildGovernanceHeaders } from '../utils/governanceHeaders';

// ============================================
// TYPES
// ============================================

export interface PersistenceOptions {
    isAuthenticated: boolean;
    accessToken?: string;
}

export interface CanvasState {
    zoom: number;
    panX: number;
    panY: number;
}

export interface WorkflowSaveData {
    id: string;
    name?: string;
    description?: string;
    canvasState?: CanvasState;
    nodes?: Array<{
        id: string;
        type: string;
        position: { x: number; y: number };
        data: Record<string, any>;
    }>;
    edges?: Array<{
        id: string;
        source: string;
        target: string;
        type?: string;
    }>;
}

export interface AgentInstanceSaveData {
    id: string;
    position?: { x: number; y: number };
    status?: 'running' | 'completed' | 'failed' | 'stopped';
    userNotes?: string;
    tags?: string[];
    // ⭐ FIX QA: Include persistenceConfig for media storage options
    persistenceConfig?: {
        saveChat?: boolean;
        saveErrors?: boolean;
        saveHistorySummary?: boolean;
        saveLinks?: boolean;
        saveTasks?: boolean;
        saveMedia?: boolean;
        mediaStorage?: 'db' | 'workspace' | 'cloud';
        allowWorkspaceWrite?: boolean;
        cloudConnectionProfileId?: string;
        cloudStorageConfig?: any;
    };
}

function normalizePersistenceConfigForApi<T extends { mediaStorage?: string }>(
    config?: (PersistenceConfig & T) | null
): (PersistenceConfig & T) | undefined {
    if (!config) {
        return undefined;
    }

    return normalizePersistenceConfig({
        ...config,
        mediaStorage: normalizeMediaStorageType(config.mediaStorage as any)
    }) as PersistenceConfig & T;
}

export interface AgentInstanceContent {
    type: 'chat' | 'image' | 'video' | 'error';
    role?: string;
    message?: string;
    mediaId?: string;
    prompt?: string;
    url?: string;
    duration?: number;
    subType?: string;
    timestamp?: Date;
    metadata?: Record<string, any>;
}

// ============================================
// WORKFLOW PERSISTENCE
// ============================================

// ⭐ SELF-HEALING: Liste des IDs placeholder invalides
const INVALID_WORKFLOW_IDS = [
    'default-workflow',
    'new-workflow', 
    'temp-workflow',
    'placeholder',
    ''
];

/**
 * Validates that a workflow ID is not a placeholder
 * @returns true if ID is valid (not a placeholder)
 */
function isValidWorkflowId(id: string): boolean {
    if (!id) return false;
    if (INVALID_WORKFLOW_IDS.includes(id.toLowerCase())) return false;
    // MongoDB ObjectId pattern (24 hex chars)
    return /^[a-f\d]{24}$/i.test(id);
}

/**
 * Save workflow structure (MANUAL SAVE - Bouton 💾)
 * 
 * Mode Guest: localStorage
 * Mode Auth: PUT /api/workflows/:id
 */
export async function saveWorkflow(
    data: WorkflowSaveData,
    options: PersistenceOptions
): Promise<{ success: boolean; error?: string }> {
    try {
        if (!options.isAuthenticated) {
            // Guest mode: localStorage
            const existing = localStorage.getItem(GUEST_STORAGE_KEYS.WORKFLOW);
            const workflow = existing ? JSON.parse(existing) : {};
            
            const updated = {
                ...workflow,
                ...data,
                updatedAt: new Date().toISOString()
            };
            
            localStorage.setItem(GUEST_STORAGE_KEYS.WORKFLOW, JSON.stringify(updated));
            
            // Also save nodes and edges separately for compatibility
            if (data.nodes) {
                localStorage.setItem(GUEST_STORAGE_KEYS.WORKFLOW_NODES, JSON.stringify(data.nodes));
            }
            if (data.edges) {
                localStorage.setItem(GUEST_STORAGE_KEYS.WORKFLOW_EDGES, JSON.stringify(data.edges));
            }
            
            console.log('[PersistenceService] Workflow saved to localStorage');
            return { success: true };
        }

        // Authenticated mode: API
        if (!options.accessToken) {
            return { success: false, error: 'No access token provided' };
        }

        // ⭐ SELF-HEALING: Validate workflow ID before API call
        if (!isValidWorkflowId(data.id)) {
            console.error('[PersistenceService] Invalid workflow ID:', data.id);
            return { 
                success: false, 
                error: `Invalid workflow ID: "${data.id}". Please refresh the page to get the real workflow ID from the server.`
            };
        }

        const response = await fetch(`${API_BASE_URL}/api/workflows/${data.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${options.accessToken}`
            },
            body: JSON.stringify({
                name: data.name,
                description: data.description,
                canvasState: data.canvasState,
                // Note: nodes and edges are saved via agent-instances
                isDirty: false,
                lastSavedAt: new Date().toISOString()
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            return { 
                success: false, 
                error: errorData.message || `HTTP ${response.status}` 
            };
        }

        console.log('[PersistenceService] Workflow saved to API');
        return { success: true };
        
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        console.error('[PersistenceService] saveWorkflow error:', errorMsg);
        return { success: false, error: errorMsg };
    }
}

/**
 * Save canvas state only (optimized for frequent updates)
 */
export async function saveCanvasState(
    workflowId: string,
    canvasState: CanvasState,
    options: PersistenceOptions
): Promise<{ success: boolean; error?: string }> {
    return saveWorkflow({ id: workflowId, canvasState }, options);
}

// ============================================
// AGENT INSTANCE PERSISTENCE (AUTO-SAVE)
// ============================================

/**
 * ⭐ CREATE agent instance (AUTO-SAVE - Immediate on creation)
 * Called when user adds an agent to the workflow canvas
 * 
 * NOTE: This is INDEPENDENT of workflow save mode (manual/auto)
 * Agent instances are ALWAYS auto-saved per Dev_rules.md
 * 
 * @param data - Instance data including prototypeId, position, name
 * @param workflowId - Current workflow ID (must be valid MongoDB ObjectId)
 * @param options - Authentication options
 */
export interface CreateAgentInstanceData {
    id: string;           // Frontend-generated ID (will be replaced by backend ID in response)
    prototypeId: string;
    name: string;
    position: { x: number; y: number };
    configuration_json?: Record<string, any>;
    persistenceConfig?: PersistenceConfig; // ⭐ NEW: Override config from WorkflowValidationModal
}

export async function createAgentInstance(
    data: CreateAgentInstanceData,
    workflowId: string,
    options: PersistenceOptions
): Promise<{ success: boolean; backendId?: string; instance?: any; error?: string }> {
    try {
        if (!options.isAuthenticated) {
            // Guest mode: localStorage - just store with frontend ID
            const existing = localStorage.getItem(GUEST_STORAGE_KEYS.AGENT_INSTANCES);
            const instances = existing ? JSON.parse(existing) : [];
            
            instances.push({
                ...data,
                workflowId: 'guest-workflow',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                content: [],
                metrics: { totalTokens: 0, totalErrors: 0, totalMediaGenerated: 0, callCount: 0 }
            });
            
            localStorage.setItem(GUEST_STORAGE_KEYS.AGENT_INSTANCES, JSON.stringify(instances));
            console.log('[PersistenceService] ✅ Agent instance created in localStorage:', data.id);
            return { success: true, backendId: data.id };
        }

        // Authenticated mode: API POST
        if (!options.accessToken) {
            return { success: false, error: 'No access token provided' };
        }

        // Validate workflowId
        if (!isValidWorkflowId(workflowId)) {
            console.error('[PersistenceService] ❌ Cannot create instance: invalid workflowId:', workflowId);
            return { 
                success: false, 
                error: `Cannot create agent instance: workflow ID "${workflowId}" is invalid. Please refresh the page.`
            };
        }

        console.log('[PersistenceService] 📤 Creating agent instance:', {
            workflowId,
            prototypeId: data.prototypeId,
            name: data.name,
            position: data.position,
            persistenceConfig: summarizePersistenceConfig(normalizePersistenceConfigForApi(data.persistenceConfig))
        });

        const response = await fetch(`${API_BASE_URL}/api/workflows/${workflowId}/instances/from-prototype`, {
            method: 'POST',
            headers: buildGovernanceHeaders(options.accessToken, {
                'Content-Type': 'application/json'
            }),
            body: JSON.stringify({
                prototypeId: data.prototypeId,
                position: data.position,
                name: data.name,
                configuration_json: data.configuration_json,
                persistenceConfig: normalizePersistenceConfigForApi(data.persistenceConfig)
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('[PersistenceService] ❌ Create instance failed:', errorData);
            return { 
                success: false, 
                error: errorData.message || errorData.error || `HTTP ${response.status}` 
            };
        }

        const response_data = await response.json();
        console.log('[PersistenceService] ✅ Agent instance created in DB:', response_data.instance?._id || response_data._id);
        
        // ✅ ÉTAPE 2: Retourner l'instance complète avec configuration_json
        // Le backend retourne { instance: {..., configuration_json}, node: {...} }
        const backendInstance = response_data.instance || response_data;
        // ⭐ CRITICAL FIX: Convertir ObjectId en string pour éviter mismatch avec tempId string
        const backendIdString = (backendInstance._id || backendInstance.id)?.toString?.() || backendInstance._id || backendInstance.id;
        return { 
            success: true, 
            backendId: backendIdString,
            instance: backendInstance // ✅ Instance complète avec configuration_json enrichie
        };
        
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        console.error('[PersistenceService] createAgentInstance error:', errorMsg);
        return { success: false, error: errorMsg };
    }
}

/**
 * Save agent instance position/config (AUTO-SAVE)
 * Called on drag, resize, config change
 */
export async function saveAgentInstance(
    data: AgentInstanceSaveData,
    options: PersistenceOptions
): Promise<{ success: boolean; error?: string }> {
    try {
        if (!options.isAuthenticated) {
            // Guest mode: localStorage
            const existing = localStorage.getItem(GUEST_STORAGE_KEYS.AGENT_INSTANCES);
            const instances = existing ? JSON.parse(existing) : [];
            
            const index = instances.findIndex((i: any) => i.id === data.id);
            if (index >= 0) {
                instances[index] = { ...instances[index], ...data, updatedAt: new Date().toISOString() };
            } else {
                instances.push({ ...data, updatedAt: new Date().toISOString() });
            }
            
            localStorage.setItem(GUEST_STORAGE_KEYS.AGENT_INSTANCES, JSON.stringify(instances));
            console.log('[PersistenceService] Agent instance saved to localStorage');
            return { success: true };
        }

        // Authenticated mode: API
        if (!options.accessToken) {
            return { success: false, error: 'No access token provided' };
        }

        const response = await fetch(`${API_BASE_URL}/api/agent-instances/${data.id}`, {
            method: 'PUT',
            headers: buildGovernanceHeaders(options.accessToken, {
                'Content-Type': 'application/json'
            }),
            body: JSON.stringify({
                ...data,
                persistenceConfig: normalizePersistenceConfigForApi(data.persistenceConfig as any)
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            return { 
                success: false, 
                error: errorData.message || `HTTP ${response.status}` 
            };
        }

        console.log('[PersistenceService] Agent instance saved to API');
        return { success: true };
        
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        console.error('[PersistenceService] saveAgentInstance error:', errorMsg);
        return { success: false, error: errorMsg };
    }
}

/**
 * Add content to agent instance (AUTO-SAVE)
 * Called after each chat message, image generation, error
 * 
 * ⭐ ÉTAPE 1.6: Contenu polymorphe (chat/image/video/error)
 */
export async function addAgentInstanceContent(
    instanceId: string,
    content: AgentInstanceContent,
    options: PersistenceOptions
): Promise<{ success: boolean; error?: string }> {
    try {
        // Add timestamp if not provided
        const contentWithTimestamp = {
            ...content,
            timestamp: content.timestamp || new Date()
        };

        if (!options.isAuthenticated) {
            // Guest mode: localStorage
            const existing = localStorage.getItem(GUEST_STORAGE_KEYS.AGENT_INSTANCES);
            const instances = existing ? JSON.parse(existing) : [];
            
            const index = instances.findIndex((i: any) => i.id === instanceId);
            if (index >= 0) {
                if (!instances[index].content) {
                    instances[index].content = [];
                }
                instances[index].content.push(contentWithTimestamp);
                instances[index].updatedAt = new Date().toISOString();
                
                // Update metrics
                if (!instances[index].metrics) {
                    instances[index].metrics = { totalTokens: 0, totalErrors: 0, totalMediaGenerated: 0, callCount: 0 };
                }
                if (content.type === 'chat') {
                    instances[index].metrics.callCount++;
                    if (content.metadata?.tokensUsed) {
                        instances[index].metrics.totalTokens += content.metadata.tokensUsed;
                    }
                } else if (content.type === 'error') {
                    instances[index].metrics.totalErrors++;
                } else if (content.type === 'image' || content.type === 'video') {
                    instances[index].metrics.totalMediaGenerated++;
                }
            }
            
            localStorage.setItem(GUEST_STORAGE_KEYS.AGENT_INSTANCES, JSON.stringify(instances));
            console.log('[PersistenceService] Content added to localStorage');
            return { success: true };
        }

        // Authenticated mode: API
        if (!options.accessToken) {
            return { success: false, error: 'No access token provided' };
        }

        const response = await fetch(`${API_BASE_URL}/api/agent-instances/${instanceId}/content`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${options.accessToken}`
            },
            body: JSON.stringify({ content: contentWithTimestamp })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            return { 
                success: false, 
                error: errorData.message || `HTTP ${response.status}` 
            };
        }

        console.log('[PersistenceService] Content added via API');
        return { success: true };
        
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        console.error('[PersistenceService] addAgentInstanceContent error:', errorMsg);
        return { success: false, error: errorMsg };
    }
}

// ============================================
// HELPER: Create content helpers
// ============================================

/**
 * Create chat content object
 */
export function createChatContent(
    role: 'user' | 'agent' | 'tool',
    message: string,
    metadata?: { llmProvider?: string; modelUsed?: string; tokensUsed?: number }
): AgentInstanceContent {
    return {
        type: 'chat',
        role,
        message,
        timestamp: new Date(),
        metadata
    };
}

/**
 * Create error content object
 */
export function createErrorContent(
    subType: string,
    message: string,
    source: 'llm_service' | 'tool_executor' | 'frontend',
    retryable: boolean = false,
    attempts: number = 1,
    errorCode?: string
): AgentInstanceContent {
    return {
        type: 'error',
        subType,
        message,
        timestamp: new Date(),
        metadata: {
            source,
            retryable,
            attempts,
            errorCode
        }
    };
}

/**
 * Create image content object
 */
export function createImageContent(
    mediaId: string,
    prompt: string,
    url: string,
    model: string,
    size: string
): AgentInstanceContent {
    return {
        type: 'image',
        mediaId,
        prompt,
        url,
        timestamp: new Date(),
        metadata: { model, size }
    };
}

// ============================================
// EXPORT SERVICE OBJECT
// ============================================

export const PersistenceService = {
    saveWorkflow,
    saveCanvasState,
    createAgentInstance,  // ⭐ NEW: Auto-save on creation
    saveAgentInstance,
    addAgentInstanceContent,
    createChatContent,
    createErrorContent,
    createImageContent
};

export default PersistenceService;

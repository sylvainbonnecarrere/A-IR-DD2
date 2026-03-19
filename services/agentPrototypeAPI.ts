/**
 * @file agentPrototypeAPI.ts
 * @description API client pour la persistence des prototypes d'agents (MongoDB)
 * @domain Design Domain - Persistence
 * 
 * SCOPE: Utilisateurs CONNECTÉS uniquement
 * - Les guests utilisent Zustand (localStorage) directement
 * - Ce service n'est appelé QUE si isAuthenticated === true
 * 
 * SOLID: Single Responsibility - Appels HTTP uniquement
 */

import { getBackendUrl } from '../config/api.config';
import { Agent } from '../types';
import { buildGovernanceHeaders } from '../utils/governanceHeaders';

const API_BASE = `${getBackendUrl()}/api/agent-prototypes`;

/**
 * Payload pour création/update (sans les champs auto-générés)
 */
type AgentPrototypePayload = Omit<Agent, 'id' | 'creator_id' | 'created_at' | 'updated_at'>;

/**
 * Réponse API standardisée
 */
interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Convertit le format Agent frontend vers le format API backend
 * Frontend: model, creator_id, capabilities (enum array)
 * Backend: llmModel, robotId, capabilities (string array)
 */
function mapAgentToAPIPayload(agentData: AgentPrototypePayload, robotId: string, workflowId?: string): Record<string, any> {
  const toolSelections = agentData.toolSelections?.length ? agentData.toolSelections : undefined;
  const functionIds = agentData.functionIds?.length
    ? agentData.functionIds
    : toolSelections?.map(selection => selection.toolId);

  const payload: Record<string, any> = {
    name: agentData.name || '',
    role: agentData.role || '',
    systemPrompt: agentData.systemPrompt || '',
    llmProvider: String(agentData.llmProvider), // Convert enum to string
    llmModel: agentData.model || '', // Frontend uses 'model', backend expects 'llmModel'
    capabilities: agentData.capabilities?.map(c => String(c)) || [],
    historyConfig: agentData.historyConfig || undefined,
    // C3 FIX: Envoyer functionIds (V2) au lieu de tools (legacy)
    // tools legacy omis intentionnellement — le backend les stocke en legacyTools
    functionIds,
    toolSelections,
    outputConfig: agentData.outputConfig || undefined,
    robotId: robotId // Frontend uses 'creator_id', backend expects 'robotId'
  };
  
  // ⭐ V2: Include workflowId to scope prototype to a workflow
  if (workflowId) {
    payload.workflowId = workflowId;
  }

  // ⭐ NEW: Include localLLMProfileId if set
  if (agentData.localLLMProfileId) {
    payload.localLLMProfileId = agentData.localLLMProfileId;
  }

  return payload;
}

/**
 * Convertit le format API backend vers le format Agent frontend
 * Backend: llmModel, robotId, _id, userId
 * Frontend: model, creator_id, id
 */
export function mapAPIResponseToAgent(apiData: any): Agent {
  const toolSelections = Array.isArray(apiData.toolSelections)
    ? apiData.toolSelections
    : [];
  const functionIds = apiData.functionIds
    || toolSelections.map((selection: any) => selection.toolId).filter(Boolean)
    || (apiData.tools || []).map((id: any) => id.toString()).filter(Boolean)
    || [];

  return {
    id: apiData._id || apiData.id,
    name: apiData.name || '',
    role: apiData.role || '',
    systemPrompt: apiData.systemPrompt || '',
    llmProvider: apiData.llmProvider,
    model: apiData.llmModel || '', // Backend uses 'llmModel', frontend expects 'model'
    capabilities: apiData.capabilities || [],
    historyConfig: apiData.historyConfig,
    tools: apiData.legacyTools || undefined, // legacy tools (non-ObjectId objects)
    // C3/C4/C5 FIX: mapper functionIds depuis la réponse API
    // apiData.functionIds est ajouté par les handlers backend (tools.map(id.toString()))
    functionIds,
    toolSelections,
    outputConfig: apiData.outputConfig,
    creator_id: apiData.robotId, // Backend uses 'robotId', frontend expects 'creator_id'
    created_at: apiData.createdAt || new Date().toISOString(),
    updated_at: apiData.updatedAt || new Date().toISOString(),
    localLLMProfileId: apiData.localLLMProfileId || undefined
  };
}

/**
 * Créer un prototype dans MongoDB
 * @param agentData - Données du prototype (sans id)
 * @param accessToken - JWT token de l'utilisateur connecté
 * @param robotId - ID du robot créateur (ex: 'AR_001')
 * @returns APIResponse avec le prototype créé (incluant _id MongoDB)
 */
export async function createAgentPrototype(
  agentData: AgentPrototypePayload,
  accessToken: string,
  robotId: string,
  workflowId?: string
): Promise<APIResponse<any>> {
  try {
    const payload = mapAgentToAPIPayload(agentData, robotId, workflowId);
    
    const response = await fetch(API_BASE, {
      method: 'POST',
      headers: buildGovernanceHeaders(accessToken, {
        'Content-Type': 'application/json'
      }),
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[agentPrototypeAPI] Create failed:', response.status, errorData);
      return { 
        success: false, 
        error: errorData.error || `HTTP ${response.status}` 
      };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (err) {
    console.error('[agentPrototypeAPI] Create error:', err);
    return { 
      success: false, 
      error: err instanceof Error ? err.message : 'Network error' 
    };
  }
}

/**
 * Mettre à jour un prototype dans MongoDB
 * @param prototypeId - ID MongoDB du prototype
 * @param agentData - Données partielles à mettre à jour
 * @param accessToken - JWT token
 * @param robotId - ID du robot créateur (ex: 'AR_001')
 * @returns APIResponse avec le prototype mis à jour
 */
export async function updateAgentPrototype(
  prototypeId: string,
  agentData: Partial<AgentPrototypePayload>,
  accessToken: string,
  robotId: string
): Promise<APIResponse<any>> {
  try {
    // Map only provided fields
    const payload: Record<string, any> = {};
    if (agentData.name !== undefined) payload.name = agentData.name;
    if (agentData.role !== undefined) payload.role = agentData.role;
    if (agentData.systemPrompt !== undefined) payload.systemPrompt = agentData.systemPrompt;
    if (agentData.llmProvider !== undefined) payload.llmProvider = agentData.llmProvider;
    if (agentData.model !== undefined) payload.llmModel = agentData.model;
    if (agentData.capabilities !== undefined) payload.capabilities = agentData.capabilities.map(c => String(c));
    if (agentData.historyConfig !== undefined) payload.historyConfig = agentData.historyConfig;
    if (agentData.tools !== undefined) payload.tools = agentData.tools;
    if (agentData.functionIds !== undefined) payload.functionIds = agentData.functionIds; // C3 FIX
    if (agentData.toolSelections !== undefined) payload.toolSelections = agentData.toolSelections;
    if (agentData.outputConfig !== undefined) payload.outputConfig = agentData.outputConfig;
    if (agentData.localLLMProfileId !== undefined) payload.localLLMProfileId = agentData.localLLMProfileId;
    if (robotId) payload.robotId = robotId;
    
    const response = await fetch(`${API_BASE}/${prototypeId}`, {
      method: 'PUT',
      headers: buildGovernanceHeaders(accessToken, {
        'Content-Type': 'application/json'
      }),
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[agentPrototypeAPI] Update failed:', response.status, errorData);
      return { 
        success: false, 
        error: errorData.error || `HTTP ${response.status}` 
      };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (err) {
    console.error('[agentPrototypeAPI] Update error:', err);
    return { 
      success: false, 
      error: err instanceof Error ? err.message : 'Network error' 
    };
  }
}

/**
 * Supprimer un prototype dans MongoDB
 * @param prototypeId - ID MongoDB du prototype
 * @param accessToken - JWT token
 * @returns APIResponse avec confirmation
 */
export async function deleteAgentPrototype(
  prototypeId: string,
  accessToken: string
): Promise<APIResponse<void>> {
  try {
    const response = await fetch(`${API_BASE}/${prototypeId}`, {
      method: 'DELETE',
      headers: buildGovernanceHeaders(accessToken)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[agentPrototypeAPI] Delete failed:', response.status, errorData);
      return { 
        success: false, 
        error: errorData.error || `HTTP ${response.status}` 
      };
    }

    return { success: true };
  } catch (err) {
    console.error('[agentPrototypeAPI] Delete error:', err);
    return { 
      success: false, 
      error: err instanceof Error ? err.message : 'Network error' 
    };
  }
}

/**
 * R\u00e9cup\u00e9rer les prototypes de l'utilisateur connect\u00e9 (filtr\u00e9s par workflow)
 * @param accessToken - JWT token
 * @param workflowId - Optional workflow ID to filter prototypes
 * @returns APIResponse avec la liste des prototypes
 */
export async function fetchAgentPrototypes(
  accessToken: string,
  workflowId?: string
): Promise<APIResponse<any[]>> {
  try {
    // ⭐ SECURITY: URL-encode to prevent injection
    const url = workflowId ? `${API_BASE}?workflowId=${encodeURIComponent(workflowId)}` : API_BASE;
    const response = await fetch(url, {
      method: 'GET',
      headers: buildGovernanceHeaders(accessToken)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[agentPrototypeAPI] Fetch failed:', response.status, errorData);
      return { 
        success: false, 
        error: errorData.error || `HTTP ${response.status}` 
      };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (err) {
    console.error('[agentPrototypeAPI] Fetch error:', err);
    return { 
      success: false, 
      error: err instanceof Error ? err.message : 'Network error' 
    };
  }
}

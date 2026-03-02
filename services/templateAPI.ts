/**
 * @file templateAPI.ts
 * @description API client pour agent templates persistés en MongoDB
 * @domain Design Domain - Persistence Layer
 * @scope Utilisateurs CONNECTÉS uniquement
 * @auth JWT Bearer token required for all endpoints
 */

import { getBackendUrl } from '../config/api.config';

const API_BASE = `${getBackendUrl()}/api/agent-templates`;

// ============================================
// TYPE DEFINITIONS
// ============================================

/**
 * Agent Template DTO (Data Transfer Object)
 * Structure de données pour les templates persistés dans MongoDB
 */
export interface AgentTemplateDTO {
  _id: string;
  userId: string;
  name: string;
  description: string;
  category: 'assistant' | 'specialist' | 'automation' | 'analysis';
  robotId: 'AR_001' | 'BO_002' | 'CO_003' | 'PH_004' | 'TI_005'; // ⭐ Fixed to match RobotId enum values
  icon: string;
  template: {
    name: string;
    role: string;
    systemPrompt: string;
    llmProvider: string;
    llmModel: string;
    capabilities: string[];
    tools?: any[];
    outputConfig?: any;
    historyConfig?: any;
  };
  sourcePrototypeId?: string;
  usageCount: number;
  isStarred: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Payload pour créer un template (sans _id, createdAt, updatedAt, usageCount)
 */
export type CreateTemplatePayload = Omit<
  AgentTemplateDTO,
  '_id' | 'userId' | 'createdAt' | 'updatedAt' | 'usageCount'
>;

/**
 * Payload pour mettre à jour un template (tous les champs optionnels)
 */
export type UpdateTemplatePayload = Partial<CreateTemplatePayload>;

/**
 * API Response wrapper
 */
interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  details?: any[];
  meta?: {
    total?: number;
    limit?: number;
    skip?: number;
  };
}

// ============================================
// ERROR HANDLING
// ============================================

/**
 * Parse erreur API et extraire message
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown error';
}

/**
 * Custom Error class pour API errors
 */
export class TemplateAPIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public details?: any
  ) {
    super(message);
    this.name = 'TemplateAPIError';
  }
}

// ============================================
// 1️⃣ GET /api/agent-templates - List Templates with Filtering
// ============================================

/**
 * Récupérer tous les templates de l'utilisateur avec filtering optionnel
 * 
 * @param accessToken JWT token d'authentification
 * @param options Filtering et pagination options
 * @returns Array of templates
 * @throws TemplateAPIError
 */
export async function fetchTemplates(
  accessToken: string,
  options?: {
    category?: 'assistant' | 'specialist' | 'automation' | 'analysis';
    isStarred?: boolean;
    search?: string;
    limit?: number;
    skip?: number;
    sortBy?: 'createdAt' | 'usageCount' | 'name';
    sortOrder?: 'asc' | 'desc';
  }
): Promise<AgentTemplateDTO[]> {
  try {
    // Build query string
    const params = new URLSearchParams();
    if (options?.category) params.append('category', options.category);
    if (options?.isStarred !== undefined) params.append('isStarred', String(options.isStarred));
    if (options?.search) params.append('search', options.search);
    if (options?.limit) params.append('limit', String(options.limit));
    if (options?.skip) params.append('skip', String(options.skip));
    if (options?.sortBy) params.append('sortBy', options.sortBy);
    if (options?.sortOrder) params.append('sortOrder', options.sortOrder);

    const url = params.toString() ? `${API_BASE}?${params}` : API_BASE;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.status === 401) {
      throw new TemplateAPIError('Authentication expired', 401);
    }

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as APIResponse<any>;
      throw new TemplateAPIError(
        errorData.error || `HTTP ${response.status}`,
        response.status,
        errorData.details
      );
    }

    const data = (await response.json()) as APIResponse<AgentTemplateDTO[]>;
    return data.data || [];
  } catch (error) {
    console.error('[templateAPI] fetchTemplates error:', error);
    throw error instanceof TemplateAPIError ? error : new TemplateAPIError(getErrorMessage(error));
  }
}

// ============================================
// 2️⃣ GET /api/agent-templates/:id - Get Single Template
// ============================================

/**
 * Récupérer UN template spécifique
 * 
 * @param templateId MongoDB ObjectId du template
 * @param accessToken JWT token
 * @returns Template object
 * @throws TemplateAPIError (404 if not found or not owned)
 */
export async function fetchTemplate(
  templateId: string,
  accessToken: string
): Promise<AgentTemplateDTO> {
  try {
    const response = await fetch(`${API_BASE}/${templateId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.status === 401) {
      throw new TemplateAPIError('Authentication expired', 401);
    }

    if (response.status === 404) {
      throw new TemplateAPIError('Template not found or not owned', 404);
    }

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as APIResponse<any>;
      throw new TemplateAPIError(
        errorData.error || `HTTP ${response.status}`,
        response.status,
        errorData.details
      );
    }

    const data = (await response.json()) as APIResponse<AgentTemplateDTO>;
    if (!data.data) {
      throw new TemplateAPIError('No template data in response');
    }
    return data.data;
  } catch (error) {
    console.error('[templateAPI] fetchTemplate error:', error);
    throw error instanceof TemplateAPIError ? error : new TemplateAPIError(getErrorMessage(error));
  }
}

// ============================================
// 3️⃣ POST /api/agent-templates - Create Template
// ============================================

/**
 * Créer un nouveau template
 * 
 * @param template Template data (without _id, createdAt, updatedAt, usageCount)
 * @param accessToken JWT token
 * @returns Newly created template with _id
 * @throws TemplateAPIError
 */
export async function createTemplate(
  template: CreateTemplatePayload,
  accessToken: string
): Promise<AgentTemplateDTO> {
  try {
    const response = await fetch(API_BASE, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(template)
    });

    if (response.status === 401) {
      throw new TemplateAPIError('Authentication expired', 401);
    }

    if (response.status === 400) {
      const errorData = (await response.json().catch(() => ({}))) as APIResponse<any>;
      throw new TemplateAPIError(
        errorData.error || 'Validation failed',
        400,
        errorData.details
      );
    }

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as APIResponse<any>;
      throw new TemplateAPIError(
        errorData.error || `HTTP ${response.status}`,
        response.status
      );
    }

    const data = (await response.json()) as APIResponse<AgentTemplateDTO>;
    if (!data.data) {
      throw new TemplateAPIError('No template data in response');
    }
    return data.data;
  } catch (error) {
    console.error('[templateAPI] createTemplate error:', error);
    throw error instanceof TemplateAPIError ? error : new TemplateAPIError(getErrorMessage(error));
  }
}

// ============================================
// 4️⃣ PUT /api/agent-templates/:id - Update Template
// ============================================

/**
 * Mettre à jour un template existant (partial update)
 * 
 * @param templateId MongoDB ObjectId
 * @param updates Partial template updates
 * @param accessToken JWT token
 * @returns Updated template
 * @throws TemplateAPIError
 */
export async function updateTemplate(
  templateId: string,
  updates: UpdateTemplatePayload,
  accessToken: string
): Promise<AgentTemplateDTO> {
  try {
    const response = await fetch(`${API_BASE}/${templateId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updates)
    });

    if (response.status === 401) {
      throw new TemplateAPIError('Authentication expired', 401);
    }

    if (response.status === 404) {
      throw new TemplateAPIError('Template not found or not owned', 404);
    }

    if (response.status === 400) {
      const errorData = (await response.json().catch(() => ({}))) as APIResponse<any>;
      throw new TemplateAPIError(
        errorData.error || 'Validation failed',
        400,
        errorData.details
      );
    }

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as APIResponse<any>;
      throw new TemplateAPIError(
        errorData.error || `HTTP ${response.status}`,
        response.status
      );
    }

    const data = (await response.json()) as APIResponse<AgentTemplateDTO>;
    if (!data.data) {
      throw new TemplateAPIError('No template data in response');
    }
    return data.data;
  } catch (error) {
    console.error('[templateAPI] updateTemplate error:', error);
    throw error instanceof TemplateAPIError ? error : new TemplateAPIError(getErrorMessage(error));
  }
}

// ============================================
// 5️⃣ DELETE /api/agent-templates/:id - Delete Template
// ============================================

/**
 * Supprimer un template
 * 
 * @param templateId MongoDB ObjectId
 * @param accessToken JWT token
 * @throws TemplateAPIError
 */
export async function deleteTemplate(
  templateId: string,
  accessToken: string
): Promise<void> {
  try {
    const response = await fetch(`${API_BASE}/${templateId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.status === 401) {
      throw new TemplateAPIError('Authentication expired', 401);
    }

    if (response.status === 404) {
      throw new TemplateAPIError('Template not found or not owned', 404);
    }

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as APIResponse<any>;
      throw new TemplateAPIError(
        errorData.error || `HTTP ${response.status}`,
        response.status
      );
    }
  } catch (error) {
    console.error('[templateAPI] deleteTemplate error:', error);
    throw error instanceof TemplateAPIError ? error : new TemplateAPIError(getErrorMessage(error));
  }
}

// ============================================
// 6️⃣ PATCH /api/agent-templates/:id/star - Toggle Star
// ============================================

/**
 * Toggle isStarred flag d'un template (true <-> false)
 * 
 * @param templateId MongoDB ObjectId
 * @param accessToken JWT token
 * @returns Updated template with toggled isStarred
 * @throws TemplateAPIError
 */
export async function toggleTemplateStar(
  templateId: string,
  accessToken: string
): Promise<AgentTemplateDTO> {
  try {
    const response = await fetch(`${API_BASE}/${templateId}/star`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.status === 401) {
      throw new TemplateAPIError('Authentication expired', 401);
    }

    if (response.status === 404) {
      throw new TemplateAPIError('Template not found or not owned', 404);
    }

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as APIResponse<any>;
      throw new TemplateAPIError(
        errorData.error || `HTTP ${response.status}`,
        response.status
      );
    }

    const data = (await response.json()) as APIResponse<AgentTemplateDTO>;
    if (!data.data) {
      throw new TemplateAPIError('No template data in response');
    }
    return data.data;
  } catch (error) {
    console.error('[templateAPI] toggleTemplateStar error:', error);
    throw error instanceof TemplateAPIError ? error : new TemplateAPIError(getErrorMessage(error));
  }
}

// ============================================
// 7️⃣ PATCH /api/agent-templates/:id/usage - Increment Usage Count
// ============================================

/**
 * Incrémenter le usage count d'un template de manière atomique
 * Appelé quand un template est utilisé pour créer un prototype
 * 
 * @param templateId MongoDB ObjectId
 * @param accessToken JWT token
 * @returns Updated template with incremented usageCount
 * @throws TemplateAPIError
 */
export async function recordTemplateUsage(
  templateId: string,
  accessToken: string
): Promise<AgentTemplateDTO> {
  try {
    const response = await fetch(`${API_BASE}/${templateId}/usage`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.status === 401) {
      throw new TemplateAPIError('Authentication expired', 401);
    }

    if (response.status === 404) {
      throw new TemplateAPIError('Template not found or not owned', 404);
    }

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as APIResponse<any>;
      throw new TemplateAPIError(
        errorData.error || `HTTP ${response.status}`,
        response.status
      );
    }

    const data = (await response.json()) as APIResponse<AgentTemplateDTO>;
    if (!data.data) {
      throw new TemplateAPIError('No template data in response');
    }
    return data.data;
  } catch (error) {
    console.error('[templateAPI] recordTemplateUsage error:', error);
    throw error instanceof TemplateAPIError ? error : new TemplateAPIError(getErrorMessage(error));
  }
}

// ============================================
// EXPORTS
// ============================================

export default {
  fetchTemplates,
  fetchTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  toggleTemplateStar,
  recordTemplateUsage,
  TemplateAPIError
};

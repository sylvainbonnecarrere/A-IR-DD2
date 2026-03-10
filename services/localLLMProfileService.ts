/**
 * 🎯 SERVICE LAYER: Local LLM Profile Persistence
 *
 * Pattern: Strategy Pattern (mirrors llmConfigService.ts)
 * Responsibility: Route persistence calls for Local LLM Profiles
 *   - If authenticated → API backend
 *   - If guest → localStorage
 */

import { LocalLLMProfile } from '../types';
import { getBackendUrl } from '../config/api.config';
import { GUEST_STORAGE_KEYS } from '../utils/guestDataUtils';

export interface LocalLLMProfileServiceOptions {
    useApi?: boolean; // true = backend, false = localStorage
    token?: string;   // JWT token if useApi=true
}

// ============================================================================
// PART 1: LOCALSTORAGE STORAGE (Guest)
// ============================================================================

const STORAGE_KEY = GUEST_STORAGE_KEYS.LOCAL_LLM_PROFILES;

function getLocalProfiles(): LocalLLMProfile[] {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        if (!data) return [];
        return JSON.parse(data) as LocalLLMProfile[];
    } catch (error) {
        console.error('[LocalLLMProfileService] localStorage.getItem failed:', error);
        return [];
    }
}

function saveLocalProfiles(profiles: LocalLLMProfile[]): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
    } catch (error) {
        console.error('[LocalLLMProfileService] localStorage.setItem failed:', error);
        throw new Error('Impossible de sauvegarder les profils LLM local');
    }
}

// ============================================================================
// PART 2: BACKEND API (Authenticated)
// ============================================================================

async function apiRequest(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    token: string,
    body?: any
): Promise<any> {
    const options: RequestInit = {
        method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        }
    };

    if (body) {
        options.body = JSON.stringify(body);
    }

    const response = await fetch(`${getBackendUrl()}${endpoint}`, options);

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
            errorData.error || `API Error: ${response.status} ${response.statusText}`
        );
    }

    if (method === 'DELETE') {
        return response.json().catch(() => ({}));
    }

    return response.json();
}

// ============================================================================
// PART 3: EXPORTED SERVICE FUNCTIONS
// ============================================================================

/**
 * Get all local LLM profiles for the user
 */
export async function getAllProfiles(
    options: LocalLLMProfileServiceOptions
): Promise<LocalLLMProfile[]> {
    if (options.useApi && options.token) {
        return apiRequest('/api/local-llm-profiles', 'GET', options.token);
    } else {
        return getLocalProfiles();
    }
}

/**
 * Create a new local LLM profile
 */
export async function createProfile(
    data: { name: string; endpoint: string; capabilities?: Record<string, boolean>; enabled?: boolean; detectedModel?: string | null },
    options: LocalLLMProfileServiceOptions
): Promise<LocalLLMProfile> {
    if (options.useApi && options.token) {
        return apiRequest('/api/local-llm-profiles', 'POST', options.token, data);
    } else {
        const profiles = getLocalProfiles();
        const newProfile: LocalLLMProfile = {
            id: `local_${crypto.randomUUID()}`,
            name: data.name,
            endpoint: data.endpoint,
            capabilities: (data.capabilities || {}) as LocalLLMProfile['capabilities'],
            enabled: data.enabled !== undefined ? data.enabled : true,
            detectedModel: data.detectedModel ?? undefined,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Check for duplicate name
        if (profiles.some(p => p.name === data.name)) {
            throw new Error('Un profil avec ce nom existe déjà');
        }

        profiles.push(newProfile);
        saveLocalProfiles(profiles);
        return newProfile;
    }
}

/**
 * Update an existing profile
 */
export async function updateProfile(
    id: string,
    data: { name: string; endpoint: string; capabilities?: Record<string, boolean>; enabled?: boolean; detectedModel?: string | null },
    options: LocalLLMProfileServiceOptions
): Promise<LocalLLMProfile> {
    if (options.useApi && options.token) {
        return apiRequest(`/api/local-llm-profiles/${id}`, 'PUT', options.token, data);
    } else {
        const profiles = getLocalProfiles();
        const index = profiles.findIndex(p => p.id === id);

        if (index < 0) {
            throw new Error('Profil introuvable');
        }

        const updated: LocalLLMProfile = {
            ...profiles[index],
            name: data.name,
            endpoint: data.endpoint,
            capabilities: (data.capabilities || {}) as LocalLLMProfile['capabilities'],
            enabled: data.enabled !== undefined ? data.enabled : profiles[index].enabled,
            detectedModel: data.detectedModel !== undefined ? (data.detectedModel ?? undefined) : profiles[index].detectedModel,
            updatedAt: new Date().toISOString()
        };

        profiles[index] = updated;
        saveLocalProfiles(profiles);
        return updated;
    }
}

/**
 * Delete a profile
 */
export async function deleteProfile(
    id: string,
    options: LocalLLMProfileServiceOptions
): Promise<void> {
    if (options.useApi && options.token) {
        await apiRequest(`/api/local-llm-profiles/${id}`, 'DELETE', options.token);
    } else {
        const profiles = getLocalProfiles();
        const filtered = profiles.filter(p => p.id !== id);
        saveLocalProfiles(filtered);
    }
}

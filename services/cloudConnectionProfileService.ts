import {
    CloudConnectionProfile,
    CloudProvider,
    GCSStorageConfig,
    S3StorageConfig,
} from '../types';
import { getBackendUrl } from '../config/api.config';

export interface CloudConnectionProfileServiceOptions {
    useApi?: boolean;
    token?: string;
}

export interface CloudConnectionProfileUpsertData {
    displayName: string;
    provider: CloudProvider;
    enabled?: boolean;
    replaceSecret?: boolean;
    s3?: Partial<S3StorageConfig>;
    gcs?: Partial<GCSStorageConfig>;
}

export interface CloudConnectionProfileTestResponse {
    success: boolean;
    message: string;
    details?: Record<string, unknown>;
    profile?: CloudConnectionProfile;
}

function assertAuthenticated(options: CloudConnectionProfileServiceOptions): string {
    if (options.useApi && options.token) {
        return options.token;
    }

    throw new Error('Les profils cloud securises necessitent une session authentifiee');
}

async function apiRequest(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    token: string,
    body?: unknown,
): Promise<any> {
    const response = await fetch(`${getBackendUrl()}${endpoint}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `API Error: ${response.status} ${response.statusText}`);
    }

    if (method === 'DELETE') {
        return response.json().catch(() => ({}));
    }

    return response.json();
}

export async function getAllProfiles(
    options: CloudConnectionProfileServiceOptions,
): Promise<CloudConnectionProfile[]> {
    if (!options.useApi || !options.token) {
        return [];
    }

    return apiRequest('/api/cloud-connection-profiles', 'GET', options.token);
}

export async function createProfile(
    data: CloudConnectionProfileUpsertData,
    options: CloudConnectionProfileServiceOptions,
): Promise<CloudConnectionProfile> {
    return apiRequest('/api/cloud-connection-profiles', 'POST', assertAuthenticated(options), data);
}

export async function updateProfile(
    id: string,
    data: CloudConnectionProfileUpsertData,
    options: CloudConnectionProfileServiceOptions,
): Promise<CloudConnectionProfile> {
    return apiRequest(`/api/cloud-connection-profiles/${id}`, 'PUT', assertAuthenticated(options), data);
}

export async function deleteProfile(
    id: string,
    options: CloudConnectionProfileServiceOptions,
): Promise<void> {
    await apiRequest(`/api/cloud-connection-profiles/${id}`, 'DELETE', assertAuthenticated(options));
}

export async function testProfile(
    id: string,
    options: CloudConnectionProfileServiceOptions,
): Promise<CloudConnectionProfileTestResponse> {
    return apiRequest(`/api/cloud-connection-profiles/${id}/test`, 'POST', assertAuthenticated(options));
}
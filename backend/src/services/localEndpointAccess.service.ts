import { LocalLLMProfile } from '../models/LocalLLMProfile.model';
import { isAllowedLocalEndpoint } from '../utils/localEndpointPolicy';

export function normalizeEndpointForComparison(endpoint: string): string | null {
    try {
        const url = new URL(endpoint);
        const pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
        return `${url.protocol}//${url.host}${pathname}`;
    } catch {
        return null;
    }
}

export async function isEndpointAccessibleForUser(endpoint: string, userId?: string | null): Promise<boolean> {
    if (isAllowedLocalEndpoint(endpoint)) {
        return true;
    }

    if (!userId) {
        return false;
    }

    const normalizedEndpoint = normalizeEndpointForComparison(endpoint);
    if (!normalizedEndpoint) {
        return false;
    }

    const profiles = await LocalLLMProfile.find({ userId }).select('endpoint').lean();

    return profiles.some((profile) => normalizeEndpointForComparison(profile.endpoint) === normalizedEndpoint);
}

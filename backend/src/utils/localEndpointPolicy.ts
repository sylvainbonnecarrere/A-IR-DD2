const PRIVATE_IPV4_RANGES = [
    { prefix: '10.' },
    { prefix: '127.' },
    { prefix: '192.168.' },
    { prefix: '169.254.' },
] as const;

function isValidIPv4(hostname: string): boolean {
    const parts = hostname.split('.');
    if (parts.length !== 4) {
        return false;
    }

    return parts.every((part) => {
        if (!/^\d+$/.test(part)) {
            return false;
        }

        const value = Number(part);
        return value >= 0 && value <= 255;
    });
}

function isPrivateIPv4(hostname: string): boolean {
    if (!isValidIPv4(hostname)) {
        return false;
    }

    if (PRIVATE_IPV4_RANGES.some((range) => hostname.startsWith(range.prefix))) {
        return true;
    }

    const [firstOctet, secondOctet] = hostname.split('.').map(Number);
    return firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31;
}

function isAllowedHostname(hostname: string): boolean {
    const normalized = hostname.toLowerCase();

    return normalized === 'localhost'
        || normalized === '::1'
        || normalized === '[::1]'
        || normalized === 'host.docker.internal'
        || isPrivateIPv4(normalized);
}

export function isAllowedLocalEndpoint(endpoint: string): boolean {
    try {
        const url = new URL(endpoint);

        if (!['http:', 'https:'].includes(url.protocol)) {
            return false;
        }

        if (url.username || url.password) {
            return false;
        }

        if (url.search || url.hash) {
            return false;
        }

        if (url.pathname && url.pathname !== '/') {
            return false;
        }

        return isAllowedHostname(url.hostname);
    } catch {
        return false;
    }
}

export const LOCAL_ENDPOINT_POLICY_ERROR = 'Only localhost, loopback, Docker host, or private-network endpoints are allowed for local LLM access.';

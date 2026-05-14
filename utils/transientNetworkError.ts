const TRANSIENT_NETWORK_CODES = new Set([
    'ECONNABORTED',
    'ECONNREFUSED',
    'ENETDOWN',
    'ENETUNREACH',
    'ERR_CANCELED',
    'ERR_CONNECTION_REFUSED',
    'ERR_INTERNET_DISCONNECTED',
    'ERR_NETWORK',
    'ETIMEDOUT',
]);

export function getErrorMessage(error: unknown): string {
    if (error instanceof Error && typeof error.message === 'string') {
        return error.message;
    }

    if (typeof error === 'string') {
        return error;
    }

    if (error && typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
        return (error as { message: string }).message;
    }

    return 'Unknown error';
}

export function isTransientNetworkError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }

    const candidate = error as {
        code?: unknown;
        message?: unknown;
        name?: unknown;
        response?: { status?: unknown };
    };

    if (typeof candidate.code === 'string' && TRANSIENT_NETWORK_CODES.has(candidate.code)) {
        return true;
    }

    if (candidate.name === 'AbortError') {
        return true;
    }

    if (typeof candidate.response?.status === 'number' && [0, 408, 425, 429, 502, 503, 504].includes(candidate.response.status)) {
        return true;
    }

    const message = getErrorMessage(error).toLowerCase();
    return [
        'aborterror',
        'connection refused',
        'err_connection_refused',
        'failed to fetch',
        'load failed',
        'network error',
        'networkerror',
        'timeout',
    ].some(fragment => message.includes(fragment));
}
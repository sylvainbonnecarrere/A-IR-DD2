/**
 * @file providers/QueryProvider.tsx
 * @description React Query provider with default options
 */

import React, { ReactNode } from 'react';
import {
    QueryClient,
    QueryClientProvider,
    QueryCache,
    MutationCache,
} from '@tanstack/react-query';

// Create query client with default options
const createQueryClient = () => {
    return new QueryClient({
        defaultOptions: {
            queries: {
                // Cache time: 5 minutes
                gcTime: 5 * 60 * 1000,
                // Stale time: 2 minutes
                staleTime: 2 * 60 * 1000,
                // Retry failed requests once
                retry: 1,
                // Throw error to allow error boundary handling
                throwOnError: true,
            },
            mutations: {
                // Throw error to allow error boundary handling
                throwOnError: false,
            },
        },
        queryCache: new QueryCache({
            onError: (error) => {
                console.error('Query error:', error);
            },
        }),
        mutationCache: new MutationCache({
            onError: (error) => {
                console.error('Mutation error:', error);
            },
        }),
    });
};

// Keep query client instance
let queryClient: QueryClient | null = null;

export const getQueryClient = (): QueryClient => {
    if (!queryClient) {
        queryClient = createQueryClient();
    }
    return queryClient;
};

export const clearQueryClient = (): void => {
    if (!queryClient) {
        return;
    }

    void queryClient.cancelQueries();
    queryClient.clear();
};

interface QueryProviderProps {
    children: ReactNode;
}

/**
 * QueryProvider wraps the application with React Query context.
 * Handles caching, synchronization, and error management for async operations.
 */
export const QueryProvider: React.FC<QueryProviderProps> = ({ children }) => {
    const client = getQueryClient();

    return (
        <QueryClientProvider client={client}>
            {children}
        </QueryClientProvider>
    );
};

export default QueryProvider;

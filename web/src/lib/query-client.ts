import { QueryCache, QueryClient } from '@tanstack/react-query';
import { useConnectivityStore } from '../stores/connectivity-store';

function isNetworkError(error: unknown): boolean {
    return error instanceof TypeError && error.message === 'Failed to fetch';
}

export const queryClient = new QueryClient({
    queryCache: new QueryCache({
        onError(error) {
            if (isNetworkError(error)) {
                void useConnectivityStore.getState().check();
            }
        },
    }),
    defaultOptions: {
        queries: {
            staleTime: 1000 * 60 * 5, // 5 minutes
            retry: 1,
            refetchOnWindowFocus: false,
        },
        mutations: {
            retry: 0,
        },
    },
});

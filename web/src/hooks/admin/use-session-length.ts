import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAuthToken } from '../use-auth';
import { adminFetch } from './admin-fetch';
import type { ApiResponse } from './admin-settings-types';

/** ROK-1353: admin session-length (days) query + update mutation. */

const SESSION_KEY = ['admin', 'settings', 'session'] as const;

interface SessionLengthResponse {
    sessionLengthDays: number;
}

function useSessionLengthQuery() {
    return useQuery<SessionLengthResponse>({
        queryKey: [...SESSION_KEY],
        queryFn: () => adminFetch('/admin/settings/session'),
        enabled: !!getAuthToken(),
        staleTime: 30_000,
    });
}

function useSessionLengthMutation() {
    const queryClient = useQueryClient();
    return useMutation<ApiResponse, Error, number>({
        mutationFn: (sessionLengthDays) =>
            adminFetch(
                '/admin/settings/session',
                { method: 'PUT', body: JSON.stringify({ sessionLengthDays }) },
                'Failed to update session length',
            ),
        onSuccess: () =>
            queryClient.invalidateQueries({ queryKey: [...SESSION_KEY] }),
    });
}

/** Session-length query + update mutation. */
export function useSessionLength() {
    return {
        sessionLength: useSessionLengthQuery(),
        updateSessionLength: useSessionLengthMutation(),
    };
}

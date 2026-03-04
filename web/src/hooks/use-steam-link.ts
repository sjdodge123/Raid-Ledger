import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { API_BASE_URL } from '../lib/config';
import { getAuthToken } from './use-auth';
import { toast } from '../lib/toast';
import type { SteamLinkStatusDto } from '@raid-ledger/contract';

/**
 * Hook for Steam account linking (ROK-417).
 * Provides link initiation, status query, and unlink mutation.
 */
export function useSteamLink() {
    const queryClient = useQueryClient();

    const linkSteam = useCallback(() => {
        const token = getAuthToken();
        if (!token) {
            toast.error('Please log in again to link Steam');
            return;
        }
        window.location.href = `${API_BASE_URL}/auth/steam/link?token=${encodeURIComponent(token)}`;
    }, []);

    const steamStatus = useQuery<SteamLinkStatusDto>({
        queryKey: ['steam', 'status'],
        queryFn: async () => {
            const response = await fetch(`${API_BASE_URL}/auth/steam/status`, {
                headers: {
                    Authorization: `Bearer ${getAuthToken() || ''}`,
                },
            });
            if (!response.ok) throw new Error('Failed to fetch Steam status');
            return response.json();
        },
        enabled: !!getAuthToken(),
        staleTime: 30_000,
    });

    const unlinkSteam = useMutation<void, Error>({
        mutationFn: async () => {
            const response = await fetch(`${API_BASE_URL}/auth/steam/link`, {
                method: 'DELETE',
                headers: {
                    Authorization: `Bearer ${getAuthToken() || ''}`,
                },
            });
            if (!response.ok) throw new Error('Failed to unlink Steam');
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['steam', 'status'] });
            queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
            toast.success('Steam account unlinked');
        },
        onError: (err) => {
            toast.error(err.message);
        },
    });

    const syncLibrary = useMutation<{ success: boolean; message: string; matched: number; newInterests: number }, Error>({
        mutationFn: async () => {
            const response = await fetch(`${API_BASE_URL}/auth/steam/sync`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${getAuthToken() || ''}`,
                },
            });
            if (!response.ok) {
                const body = await response.json().catch(() => ({ message: 'Sync failed' }));
                throw new Error(body.message || 'Sync failed');
            }
            return response.json();
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['steam', 'status'] });
            queryClient.invalidateQueries({ queryKey: ['game-interests'] });
            toast.success(data.message);
        },
        onError: (err) => {
            toast.error(err.message);
        },
    });

    return { linkSteam, steamStatus, unlinkSteam, syncLibrary };
}

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
function steamAuthHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${getAuthToken() || ''}` };
}

async function steamFetch<T>(path: string, method = 'GET', errorMsg = 'Request failed'): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${path}`, { method, headers: steamAuthHeaders() });
    if (!response.ok) {
        const body = method === 'POST' ? await response.json().catch(() => ({ message: errorMsg })) : null;
        throw new Error(body?.message || errorMsg);
    }
    return response.json();
}

function useUnlinkSteam() {
    const queryClient = useQueryClient();
    return useMutation<void, Error>({
        mutationFn: async () => { await steamFetch('/auth/steam/link', 'DELETE', 'Failed to unlink Steam'); },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['steam', 'status'] });
            queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
            toast.success('Steam account unlinked');
        },
        onError: (err) => toast.error(err.message),
    });
}

function useSyncLibrary() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: () => steamFetch<{ success: boolean; message: string; matched: number; newInterests: number }>('/auth/steam/sync', 'POST', 'Sync failed'),
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['steam', 'status'] });
            queryClient.invalidateQueries({ queryKey: ['game-interests'] });
            toast.success(data.message);
        },
        onError: (err: Error) => toast.error(err.message),
    });
}

function useSyncWishlist() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: () => steamFetch<{ success: boolean; message: string }>('/auth/steam/sync-wishlist', 'POST', 'Wishlist sync failed'),
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['steam', 'status'] });
            queryClient.invalidateQueries({ queryKey: ['userSteamWishlist'] });
            toast.success(data.message);
        },
        onError: (err: Error) => toast.error(err.message),
    });
}

export function useSteamLink() {
    const linkSteam = useCallback(() => {
        const token = getAuthToken();
        if (!token) { toast.error('Please log in again to link Steam'); return; }
        window.location.href = `${API_BASE_URL}/auth/steam/link?token=${encodeURIComponent(token)}`;
    }, []);

    const steamStatus = useQuery<SteamLinkStatusDto>({
        queryKey: ['steam', 'status'],
        queryFn: () => steamFetch('/auth/steam/status', 'GET', 'Failed to fetch Steam status'),
        enabled: !!getAuthToken(),
        staleTime: 30_000,
    });

    const unlinkSteam = useUnlinkSteam();
    const syncLibrary = useSyncLibrary();
    const syncWishlist = useSyncWishlist();
    return { linkSteam, steamStatus, unlinkSteam, syncLibrary, syncWishlist };
}

import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { API_BASE_URL } from '../lib/config';
import { getAuthToken } from './use-auth';
import { toast } from '../lib/toast';
import { useLinkStart } from './use-link-start';
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
        const body = await response.json().catch(() => ({ message: errorMsg }));
        throw new Error(body?.message || errorMsg);
    }
    if (response.status === 204) return undefined as T;
    return response.json();
}

export function useUnlinkSteam() {
    const queryClient = useQueryClient();
    return useMutation<void, Error>({
        mutationFn: async () => { await steamFetch('/auth/steam/link', 'DELETE', 'Failed to unlink Steam'); },
        onSuccess: async () => {
            // Cancel any in-flight status refetch before writing optimistic
            // state — otherwise a refetch that started before the DELETE
            // can land after setQueryData and overwrite { linked: false }
            // with the stale { linked: true } response. Codex review fix.
            await queryClient.cancelQueries({ queryKey: ['steam', 'status'] });
            queryClient.setQueryData(['steam', 'status'], { linked: false });
            queryClient.invalidateQueries({ queryKey: ['steam', 'status'] });
            queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
            toast.success('Steam account unlinked');
        },
        onError: (err) => toast.error(err.message),
    });
}

export function useSyncLibrary() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: () => steamFetch<{ success: boolean; message: string; matched: number; newInterests: number }>('/auth/steam/sync', 'POST', 'Sync failed'),
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['steam', 'status'] });
            queryClient.invalidateQueries({ queryKey: ['game-interests'] });
            toast.success(data.message);
        },
        onError: (err: Error) => {
            queryClient.invalidateQueries({ queryKey: ['steam', 'status'] });
            toast.error(err.message);
        },
    });
}

export function useSyncWishlist() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: () => steamFetch<{ success: boolean; message: string }>('/auth/steam/sync-wishlist', 'POST', 'Wishlist sync failed'),
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['steam', 'status'] });
            queryClient.invalidateQueries({ queryKey: ['userSteamWishlist'] });
            toast.success(data.message);
        },
        onError: (err: Error) => {
            queryClient.invalidateQueries({ queryKey: ['steam', 'status'] });
            toast.error(err.message);
        },
    });
}

export function useSteamLink() {
    const { start, isPending: isLinkPending } = useLinkStart('steam');
    // ROK-1630: only a string is a returnTo — a caller wiring this straight to
    // onClick passes the click event, which must never reach the request body.
    const linkSteam = useCallback(
        (returnTo?: string) => start(typeof returnTo === 'string' ? returnTo : undefined),
        [start],
    );

    const steamStatus = useQuery<SteamLinkStatusDto>({
        queryKey: ['steam', 'status'],
        queryFn: () => steamFetch('/auth/steam/status', 'GET', 'Failed to fetch Steam status'),
        enabled: !!getAuthToken(),
        staleTime: 30_000,
    });

    const unlinkSteam = useUnlinkSteam();
    const syncLibrary = useSyncLibrary();
    const syncWishlist = useSyncWishlist();
    return { linkSteam, isLinkPending, steamStatus, unlinkSteam, syncLibrary, syncWishlist };
}

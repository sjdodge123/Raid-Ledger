/**
 * Extracted hooks from identity-panel.tsx for reuse across
 * avatar, integrations, preferences, and watched-games panels (ROK-548).
 */
import { useEffect } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { toast } from '../../lib/toast';
import { getMyPreferences, updatePreference } from '../../lib/api-client';

/** Auto-heart preference toggle state */
export function useAutoHeart(isAuthenticated: boolean, hasDiscordLinked: boolean): {
    autoHeartEnabled: boolean; toggleAutoHeart: (v: boolean) => void; isPending: boolean;
} {
    const queryClient = useQueryClient();
    const { data: prefs } = useQuery({
        queryKey: ['user-preferences'], queryFn: getMyPreferences,
        enabled: isAuthenticated && hasDiscordLinked, staleTime: Infinity,
    });
    const autoHeartMutation = useMutation({
        mutationFn: (enabled: boolean) => updatePreference('autoHeartGames', enabled),
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['user-preferences'] }); },
        onError: () => { toast.error('Failed to update auto-heart preference'); },
    });
    return {
        autoHeartEnabled: prefs?.autoHeartGames !== false,
        toggleAutoHeart: (v) => autoHeartMutation.mutate(v),
        isPending: autoHeartMutation.isPending,
    };
}

/** Show toast feedback for Steam redirect query params and clean URL (ROK-745). */
export function useSteamRedirectFeedback(): void {
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const steamParam = params.get('steam');
        if (steamParam === 'error') {
            toast.error(params.get('message') || 'Steam linking failed');
        } else if (steamParam === 'success') {
            toast.success('Steam account linked successfully!');
            if (params.get('steam_private') === 'true') {
                toast.info('Set your Steam profile to public so we can sync your game library.');
            }
        }
        if (steamParam) {
            window.history.replaceState({}, '', window.location.pathname);
        }
    }, []);
}


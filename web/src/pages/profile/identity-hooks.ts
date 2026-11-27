/**
 * Profile hooks shared by the avatar, integrations, preferences and
 * watched-games panels (ROK-548). First extracted from identity-panel.tsx,
 * which was deleted as dead code in ROK-1648.
 */
import { useEffect } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { toast } from '../../lib/toast';
import { GAME_ROLES_OPT_OUT_PREF_KEY } from '@raid-ledger/contract';
import { getMyPreferences, updatePreference } from '../../lib/api-client';
import { unlinkDiscord, unlinkGoogle } from '../../lib/api/users-api';
import { useLinkStart } from '../../hooks/use-link-start';
import { unlinkErrorMessage, type UnlinkableMethod } from './signin-methods.helpers';

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

/** Auto game roles opt-out (ROK-1767): `true` keeps the bot from giving you game roles. */
export function useGameRolesOptOut(isAuthenticated: boolean, hasDiscordLinked: boolean): {
    gameRolesEnabled: boolean; toggleGameRoles: (enabled: boolean) => void; isPending: boolean;
} {
    const queryClient = useQueryClient();
    const { data: prefs } = useQuery({
        queryKey: ['user-preferences'], queryFn: getMyPreferences,
        enabled: isAuthenticated && hasDiscordLinked, staleTime: Infinity,
    });
    const mutation = useMutation({
        mutationFn: (optOut: boolean) => updatePreference(GAME_ROLES_OPT_OUT_PREF_KEY, optOut),
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['user-preferences'] }); },
        onError: () => { toast.error('Failed to update the auto game roles preference'); },
    });
    return {
        gameRolesEnabled: prefs?.[GAME_ROLES_OPT_OUT_PREF_KEY] !== true,
        toggleGameRoles: (enabled) => mutation.mutate(!enabled),
        isPending: mutation.isPending,
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


/** ROK-2371: start the Google link (POST start → navigate to the nonce hop), like Discord's. */
export function useGoogleLinkAction(): { linkGoogle: () => void; isPending: boolean } {
    const { start, isPending } = useLinkStart('google');
    // No arguments: an onClick event must never become a request body field.
    const linkGoogle = (): void => { void start(); };
    return { linkGoogle, isPending };
}

const UNLINK: Record<UnlinkableMethod, { call: () => Promise<void>; done: string }> = {
    discord: { call: unlinkDiscord, done: 'Discord account unlinked' },
    google: { call: unlinkGoogle, done: 'Google account unlinked' },
};

/**
 * ROK-2371: unlink a sign-in method, then refresh `/auth/me`. A refusal (the
 * 409 `LAST_SIGNIN_METHOD` included) is returned as inline copy, not a toast.
 */
export function useUnlinkSigninMethod(method: UnlinkableMethod): {
    unlink: () => void; isPending: boolean; error: string | null;
} {
    const queryClient = useQueryClient();
    const mutation = useMutation({
        mutationFn: () => UNLINK[method].call(),
        onSuccess: () => {
            toast.success(UNLINK[method].done);
            void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
        },
    });
    return {
        unlink: () => mutation.mutate(),
        isPending: mutation.isPending,
        error: mutation.error ? unlinkErrorMessage(mutation.error) : null,
    };
}

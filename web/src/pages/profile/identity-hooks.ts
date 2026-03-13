/**
 * Extracted hooks from identity-panel.tsx for reuse across
 * avatar, integrations, and account panels (ROK-548).
 */
import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/use-auth';
import { useAvatarUpload } from '../../hooks/use-avatar-upload';
import { resolveAvatar, toAvatarUser, isDiscordLinked } from '../../lib/avatar';
import { toast } from '../../lib/toast';
import { getMyPreferences, updatePreference, deleteMyAccount } from '../../lib/api-client';
import type { buildAvatarOptions } from './identity-helpers';

/** Avatar upload/remove handlers */
export function useAvatarActions(refetch: () => void): {
    handleUpload: (file: File) => void;
    handleRemoveCustom: () => void;
    isUploading: boolean; uploadProgress: number;
} {
    const { upload: uploadAvatarFile, deleteAvatar, isUploading, uploadProgress } = useAvatarUpload();

    const handleUpload = useCallback((file: File) => {
        uploadAvatarFile(file, {
            onSuccess: () => { toast.success('Avatar uploaded successfully!'); refetch(); },
            onError: (err) => { toast.error(err instanceof Error ? err.message : 'Upload failed'); },
        });
    }, [uploadAvatarFile, refetch]);

    const handleRemoveCustom = useCallback(() => {
        deleteAvatar(undefined, {
            onSuccess: () => { toast.success('Custom avatar removed'); refetch(); },
            onError: (err) => { toast.error(err instanceof Error ? err.message : 'Failed to remove avatar'); },
        });
    }, [deleteAvatar, refetch]);

    return { handleUpload, handleRemoveCustom, isUploading, uploadProgress };
}

/** Avatar preference selection with optimistic URL */
export function useAvatarSelection(avatarOptions: ReturnType<typeof buildAvatarOptions>): {
    optimisticUrl: string | null; handleAvatarSelect: (url: string) => void;
} {
    const queryClient = useQueryClient();
    const [optimisticUrl, setOptimisticUrl] = useState<string | null>(null);

    const handleAvatarSelect = useCallback((url: string) => {
        const option = avatarOptions.find(o => o.url === url);
        if (!option) return;
        setOptimisticUrl(url);
        const pref = option.type === 'character'
            ? { type: option.type, characterName: option.characterName }
            : { type: option.type };
        updatePreference('avatarPreference', pref)
            .then(() => { queryClient.invalidateQueries({ queryKey: ['auth', 'me'] }); setOptimisticUrl(null); })
            .catch(() => { toast.error('Failed to save avatar preference'); setOptimisticUrl(null); });
    }, [avatarOptions, queryClient]);

    return { optimisticUrl, handleAvatarSelect };
}

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

/** Delete account mutation */
export function useDeleteAccount(confirmName: string): {
    deleteMutation: ReturnType<typeof useMutation<void, Error>>;
} {
    const { logout } = useAuth();
    const navigate = useNavigate();
    const deleteMutation = useMutation({
        mutationFn: () => deleteMyAccount(confirmName),
        onSuccess: () => { logout(); toast.success('Your account has been deleted'); navigate('/login', { replace: true }); },
        onError: (err: Error) => { toast.error(err.message || 'Failed to delete account'); },
    });
    return { deleteMutation };
}

/** Resolves the current avatar URL with optimistic override */
export function resolveCurrentAvatar(
    user: Parameters<typeof toAvatarUser>[0],
    characters: Parameters<typeof toAvatarUser>[0]['characters'],
    optimisticUrl: string | null,
): string {
    return optimisticUrl ?? (resolveAvatar(toAvatarUser({ ...user, characters })).url ?? '/default-avatar.svg');
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

/** Check if user has Discord linked for auto-heart eligibility */
export function useHasDiscordLinked(discordId: string | null): boolean {
    return isDiscordLinked(discordId);
}

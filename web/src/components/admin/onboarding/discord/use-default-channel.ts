/**
 * ROK-1703 4e — the "Post new events in" choice: the bot's text channels, the
 * saved default, and a save that runs only when the choice changed (C9).
 * Keys match `use-discord-bot-settings.ts`, so Admin → Discord sees the save.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminFetch } from '../../../../hooks/admin/admin-fetch';
import { getAuthToken } from '../../../../hooks/use-auth';
import { toast } from '../../../../lib/toast';

const BOT_KEY = ['admin', 'settings', 'discord-bot'] as const;
/** `use-onboarding.ts` status + data-sources: Done reads both. */
const ONBOARDING_KEY = ['admin', 'onboarding'] as const;

/** `PUT …/channel`; refreshes the saved default and the setup checklist. */
function useSaveDefaultChannel() {
    const queryClient = useQueryClient();
    return useMutation<unknown, Error, string>({
        mutationFn: (channelId) => adminFetch('/admin/settings/discord-bot/channel', {
            method: 'PUT', body: JSON.stringify({ channelId }),
        }, 'Failed to set default channel'),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: [...BOT_KEY, 'channel'] });
            void queryClient.invalidateQueries({ queryKey: [...BOT_KEY, 'setup-status'] });
        },
    });
}

export function useDefaultChannel(joined: boolean) {
    const enabled = !!getAuthToken() && joined;
    const channels = useQuery<{ id: string; name: string }[]>({
        queryKey: [...BOT_KEY, 'channels'],
        queryFn: () => adminFetch('/admin/settings/discord-bot/channels'),
        enabled,
    });
    const saved = useQuery<{ channelId: string | null }>({
        queryKey: [...BOT_KEY, 'channel'],
        queryFn: () => adminFetch('/admin/settings/discord-bot/channel'),
        enabled,
    });
    const queryClient = useQueryClient();
    const save = useSaveDefaultChannel();
    const [picked, setPicked] = useState<string | null>(null);
    const value = picked ?? saved.data?.channelId ?? '';

    /**
     * Saves a changed choice, refreshes the onboarding reads (cached before
     * Discord was set up, so Done would show it as skipped), then runs `next`.
     * A failed save stays on 4e.
     */
    const saveThen = async (next: () => void): Promise<void> => {
        if (value && value !== saved.data?.channelId) {
            try { await save.mutateAsync(value); } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Failed to set default channel');
                return;
            }
        }
        await queryClient.invalidateQueries({ queryKey: ONBOARDING_KEY });
        next();
    };
    return { channels: channels.data, loading: channels.isLoading, value, setValue: setPicked, saveThen, saving: save.isPending };
}

/**
 * Per-group notification mute (ROK-1832) — mirrors the per-game mute
 * (ROK-1797). The state is read from the hub page payload
 * (`viewer.notificationsMuted`, absent for non-members), so the bell makes no
 * extra request. The toggle is optimistic on the hub page query entry and
 * rolls back on error; settling invalidates it and the viewer's muted-groups
 * list. Keys are pinned at `onMutate` so a viewer switch mid-flight cannot
 * write one viewer's snapshot into another viewer's cache.
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { GuildPage, HubNotificationMuteResponseDto } from '@raid-ledger/contract';
import { fetchApi } from '../lib/api/fetch-api';
import { toast } from '../lib/toast';
import { useViewerCacheScope } from './use-auth';
import { hubMutesQueryKey } from './game-interest-query-key';
import { guildPageKey } from '../components/hub/api/use-guild';

interface HubMuteContext {
    previous: GuildPage | undefined;
    pageKey: readonly unknown[];
    mutesKey: ReturnType<typeof hubMutesQueryKey>;
}

/** Write a new mute into a cached page (no-op when the viewer is not a member). */
function withMuted(page: GuildPage, muted: boolean): GuildPage {
    return { ...page, viewer: { ...page.viewer, notificationsMuted: muted } };
}

/** The write half alone, for surfaces that already know the state (the muted-groups list). */
export function useHubNotificationMuteMutation(
    guildId: number,
): UseMutationResult<HubNotificationMuteResponseDto, Error, boolean, HubMuteContext> {
    const queryClient = useQueryClient();
    const viewer = useViewerCacheScope();
    return useMutation<HubNotificationMuteResponseDto, Error, boolean, HubMuteContext>({
        mutationFn: (muted) => fetchApi<HubNotificationMuteResponseDto>(`/guilds/${guildId}/notification-mute`, {
            method: muted ? 'POST' : 'DELETE',
        }),
        onMutate: async (muted) => {
            const pageKey = [...guildPageKey(guildId), viewer];
            const mutesKey = hubMutesQueryKey(viewer);
            await queryClient.cancelQueries({ queryKey: pageKey });
            const previous = queryClient.getQueryData<GuildPage>(pageKey);
            if (previous) queryClient.setQueryData<GuildPage>(pageKey, withMuted(previous, muted));
            return { previous, pageKey, mutesKey };
        },
        onError: (_err, _muted, context) => {
            if (context?.previous) queryClient.setQueryData(context.pageKey, context.previous);
            toast.error('Failed to update notifications for this group');
        },
        onSettled: (_data, _err, _muted, context) => {
            if (!context) return;
            void queryClient.invalidateQueries({ queryKey: context.pageKey });
            void queryClient.invalidateQueries({ queryKey: context.mutesKey });
        },
    });
}

export interface HubNotificationMuteState {
    muted: boolean;
    /** The viewer is a member, so the page carries their mute. */
    isReady: boolean;
    isPending: boolean;
    setMuted: (muted: boolean) => void;
}

/** Read + toggle the viewer's mute for one group, from the hub page payload. */
export function useHubNotificationMute(page: GuildPage): HubNotificationMuteState {
    const mutation = useHubNotificationMuteMutation(page.guild.id);
    const flag = page.viewer.notificationsMuted;
    return {
        muted: flag ?? false,
        isReady: flag !== undefined,
        isPending: mutation.isPending,
        setMuted: (muted: boolean) => mutation.mutate(muted),
    };
}

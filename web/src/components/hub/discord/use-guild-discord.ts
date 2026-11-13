/**
 * ROK-1788: TanStack Query hooks for the guild Discord channel mirror.
 * Keys extend `guildPageKey(guildId)` and end with the viewer scope (ROK-1314).
 *
 * D11: the mirror refetches every 60s, matching the server's 60s cache, and
 * only while the tab is visible — `refetchIntervalInBackground: false` pauses
 * the interval in a hidden tab (stated explicitly, not left to the default).
 */
import { useRef } from 'react';
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import type { GuildDiscordChannelListDto, GuildDiscordMirrorDto, HubWelcomeResult, SetGuildDiscordChannelDto } from '@raid-ledger/contract';
import { useViewerCacheScope } from '../../../hooks/use-auth';
import {
    deleteGuildDiscordChannel, fetchGuildDiscord, fetchGuildDiscordChannels, postGuildDiscordWelcome, putGuildDiscordChannel,
} from './guild-discord-api';
import { guildPageKey } from '../api/use-guild';
import { hubPostComposerKey } from '../posts/use-hub-posts';

export const GUILD_DISCORD_REFRESH_MS = 60_000;

export function guildDiscordKey(guildId: number): readonly unknown[] {
    return [...guildPageKey(guildId), 'discord'] as const;
}

export function guildDiscordChannelsKey(guildId: number): readonly unknown[] {
    return [...guildPageKey(guildId), 'discord-channels'] as const;
}

export function useGuildDiscord(guildId: number): UseQueryResult<GuildDiscordMirrorDto, Error> {
    return useGuildDiscordMirror(guildId).query;
}

/** The mirror query plus a Refresh that skips the server's cache for its one fetch. */
export interface GuildDiscordMirrorQuery {
    query: UseQueryResult<GuildDiscordMirrorDto, Error>;
    refresh: () => Promise<unknown>;
}

/**
 * ROK-2185 — `refresh()` flags the NEXT fetch as `?refresh=1` and refetches,
 * so the request still runs through this query (one `isFetching`, one error
 * state). Polls and Retry stay plain cached reads.
 */
export function useGuildDiscordMirror(guildId: number): GuildDiscordMirrorQuery {
    const viewer = useViewerCacheScope();
    const skipCache = useRef(false);
    const query = useQuery({
        queryKey: [...guildDiscordKey(guildId), viewer],
        queryFn: () => {
            const refresh = skipCache.current;
            skipCache.current = false;
            return fetchGuildDiscord(guildId, refresh);
        },
        enabled: guildId > 0,
        staleTime: GUILD_DISCORD_REFRESH_MS,
        refetchInterval: GUILD_DISCORD_REFRESH_MS,
        refetchIntervalInBackground: false,
        retry: false,
    });
    const refresh = (): Promise<unknown> => {
        skipCache.current = true;
        return query.refetch();
    };
    return { query, refresh };
}

/** Editors only, and only while the picker is open. */
export function useGuildDiscordChannels(guildId: number, enabled: boolean): UseQueryResult<GuildDiscordChannelListDto, Error> {
    const viewer = useViewerCacheScope();
    return useQuery({
        queryKey: [...guildDiscordChannelsKey(guildId), viewer],
        queryFn: () => fetchGuildDiscordChannels(guildId),
        enabled: enabled && guildId > 0,
        retry: false,
    });
}

/** A bind / unbind changes the mirror AND the post composer's relay switch + channel hint. */
function useRefreshChannel(guildId: number): () => Promise<unknown> {
    const queryClient = useQueryClient();
    return () => Promise.all([
        queryClient.invalidateQueries({ queryKey: guildDiscordKey(guildId) }),
        queryClient.invalidateQueries({ queryKey: hubPostComposerKey(guildId) }),
    ]);
}

export function useSetGuildDiscordChannel(guildId: number): UseMutationResult<GuildDiscordMirrorDto, Error, SetGuildDiscordChannelDto> {
    const onSuccess = useRefreshChannel(guildId);
    return useMutation<GuildDiscordMirrorDto, Error, SetGuildDiscordChannelDto>({
        mutationFn: (body) => putGuildDiscordChannel(guildId, body),
        onSuccess,
    });
}

export function useClearGuildDiscordChannel(guildId: number): UseMutationResult<void, Error, void> {
    const onSuccess = useRefreshChannel(guildId);
    return useMutation<void, Error, void>({
        mutationFn: () => deleteGuildDiscordChannel(guildId),
        onSuccess,
    });
}

/**
 * ROK-1933 — "Re-post welcome message" (Leader / staff). The welcome lands in
 * the mirrored channel, so the mirror refetches to show it.
 */
export function useRepostHubWelcome(guildId: number): UseMutationResult<HubWelcomeResult, Error, void> {
    const queryClient = useQueryClient();
    return useMutation<HubWelcomeResult, Error, void>({
        mutationFn: () => postGuildDiscordWelcome(guildId),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: guildDiscordKey(guildId) }),
    });
}

/**
 * ROK-1788: TanStack Query hooks for the guild Discord channel mirror.
 * Keys extend `guildPageKey(guildId)` and end with the viewer scope (ROK-1314).
 *
 * D11: the mirror refetches every 60s, matching the server's 60s cache, and
 * only while the tab is visible — `refetchIntervalInBackground: false` pauses
 * the interval in a hidden tab (stated explicitly, not left to the default).
 */
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import type { GuildDiscordChannelListDto, GuildDiscordMirrorDto, SetGuildDiscordChannelDto } from '@raid-ledger/contract';
import { useViewerCacheScope } from '../../../hooks/use-auth';
import {
    deleteGuildDiscordChannel, fetchGuildDiscord, fetchGuildDiscordChannels, putGuildDiscordChannel,
} from './guild-discord-api';
import { guildPageKey } from './use-guild';

export const GUILD_DISCORD_REFRESH_MS = 60_000;

export function guildDiscordKey(guildId: number): readonly unknown[] {
    return [...guildPageKey(guildId), 'discord'] as const;
}

export function guildDiscordChannelsKey(guildId: number): readonly unknown[] {
    return [...guildPageKey(guildId), 'discord-channels'] as const;
}

export function useGuildDiscord(guildId: number): UseQueryResult<GuildDiscordMirrorDto, Error> {
    const viewer = useViewerCacheScope();
    return useQuery({
        queryKey: [...guildDiscordKey(guildId), viewer],
        queryFn: () => fetchGuildDiscord(guildId),
        enabled: guildId > 0,
        staleTime: GUILD_DISCORD_REFRESH_MS,
        refetchInterval: GUILD_DISCORD_REFRESH_MS,
        refetchIntervalInBackground: false,
        retry: false,
    });
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

export function useSetGuildDiscordChannel(guildId: number): UseMutationResult<GuildDiscordMirrorDto, Error, SetGuildDiscordChannelDto> {
    const queryClient = useQueryClient();
    return useMutation<GuildDiscordMirrorDto, Error, SetGuildDiscordChannelDto>({
        mutationFn: (body) => putGuildDiscordChannel(guildId, body),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: guildDiscordKey(guildId) }),
    });
}

export function useClearGuildDiscordChannel(guildId: number): UseMutationResult<void, Error, void> {
    const queryClient = useQueryClient();
    return useMutation<void, Error, void>({
        mutationFn: () => deleteGuildDiscordChannel(guildId),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: guildDiscordKey(guildId) }),
    });
}

/**
 * ROK-1785: data for the guild entry points (nav link, drawer block, Players
 * card, character badge, game page list). Signed-out viewers never fetch.
 * Every key ends in the viewer scope (ROK-1314 `useViewerCacheScope`): the
 * payloads are membership-gated, so a shared key would show the previous
 * viewer's guilds after a sign-out + sign-in on the same browser.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { CharacterGuild, MyGuild } from '@raid-ledger/contract';
import { CharacterGuildSchema, MyGuildsSchema } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';
import { useAuth, useViewerCacheScope } from '../../../hooks/use-auth';

const BASE = '/plugins/wow/guilds';
const STALE_MS = 60_000;

export function memberCountLabel(count: number): string {
    return `${count} ${count === 1 ? 'member' : 'members'}`;
}

export function guildHref(guildId: number): string {
    return `/guilds/${guildId}`;
}

/**
 * The viewer's guilds WITH the query state. A caller that treats "no guilds"
 * as a fact (the Players "get your guild" prompt) has to tell an empty answer
 * apart from an unsettled or failed one — `useMyGuilds` cannot.
 */
export function useMyGuildsQuery(): UseQueryResult<{ guilds: MyGuild[] }, Error> {
    const { isAuthenticated } = useAuth();
    const viewer = useViewerCacheScope();
    return useQuery({
        queryKey: ['plugins', 'wow', 'guilds', 'mine', viewer],
        queryFn: () => fetchApi(`${BASE}/mine`, {}, MyGuildsSchema),
        enabled: isAuthenticated,
        staleTime: STALE_MS,
        retry: false,
    });
}

/** The viewer's guilds; `[]` while loading, on error, or signed out. */
export function useMyGuilds(): MyGuild[] {
    return useMyGuildsQuery().data?.guilds ?? [];
}

/** Guilds of one game the viewer can open (same shape as `mine`); `[]` until known. */
export function useGameGuilds(gameId: number | undefined): MyGuild[] {
    const { isAuthenticated } = useAuth();
    const viewer = useViewerCacheScope();
    const q = useQuery({
        queryKey: ['plugins', 'wow', 'guilds', 'by-game', gameId, viewer],
        queryFn: () => fetchApi(`${BASE}?gameId=${gameId}`, {}, MyGuildsSchema),
        enabled: isAuthenticated && !!gameId,
        staleTime: STALE_MS,
        retry: false,
    });
    return q.data?.guilds ?? [];
}

/** The guild a character belongs to (null when none). */
export function useCharacterGuild(characterId: string | undefined): UseQueryResult<CharacterGuild, Error> {
    const { isAuthenticated } = useAuth();
    const viewer = useViewerCacheScope();
    return useQuery({
        queryKey: ['plugins', 'wow', 'guilds', 'by-character', characterId, viewer],
        queryFn: () => fetchApi(`${BASE}/by-character/${characterId}`, {}, CharacterGuildSchema),
        enabled: isAuthenticated && !!characterId,
        staleTime: STALE_MS,
        retry: false,
    });
}

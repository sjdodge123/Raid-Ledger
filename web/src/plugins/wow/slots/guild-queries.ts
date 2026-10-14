/**
 * ROK-1785: data for the guild entry points (nav link, drawer block, Players
 * card, character badge, game page list). Signed-out viewers never fetch.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { CharacterGuild, MyGuild } from '@raid-ledger/contract';
import { CharacterGuildSchema, MyGuildsSchema } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';
import { useAuth } from '../../../hooks/use-auth';

const BASE = '/plugins/wow/guilds';
const STALE_MS = 60_000;

export function memberCountLabel(count: number): string {
    return `${count} ${count === 1 ? 'member' : 'members'}`;
}

export function guildHref(guildId: number): string {
    return `/guilds/${guildId}`;
}

/** The viewer's guilds; `[]` while loading, on error, or signed out. */
export function useMyGuilds(): MyGuild[] {
    const { isAuthenticated } = useAuth();
    const q = useQuery({
        queryKey: ['plugins', 'wow', 'guilds', 'mine'],
        queryFn: () => fetchApi(`${BASE}/mine`, {}, MyGuildsSchema),
        enabled: isAuthenticated,
        staleTime: STALE_MS,
        retry: false,
    });
    return q.data?.guilds ?? [];
}

/** Guilds of one game the viewer can open (same shape as `mine`); `[]` until known. */
export function useGameGuilds(gameId: number | undefined): MyGuild[] {
    const { isAuthenticated } = useAuth();
    const q = useQuery({
        queryKey: ['plugins', 'wow', 'guilds', 'by-game', gameId],
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
    return useQuery({
        queryKey: ['plugins', 'wow', 'guilds', 'by-character', characterId],
        queryFn: () => fetchApi(`${BASE}/by-character/${characterId}`, {}, CharacterGuildSchema),
        enabled: isAuthenticated && !!characterId,
        staleTime: STALE_MS,
        retry: false,
    });
}

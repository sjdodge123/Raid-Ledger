/**
 * ROK-1785: data for the guild entry points (nav link, drawer block, Players
 * card, character badge). Signed-out viewers never fetch.
 * Every key ends in the viewer scope (ROK-1314 `useViewerCacheScope`): the
 * payloads are membership-gated, so a shared key would show the previous
 * viewer's guilds after a sign-out + sign-in on the same browser.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { CharacterGuild } from '@raid-ledger/contract';
import { CharacterGuildSchema } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';
import { useAuth, useViewerCacheScope } from '../../../hooks/use-auth';

const BASE = '/plugins/wow/guilds';
const STALE_MS = 60_000;

/** Moved to core with the nav fillers (ROK-1870 D9); re-exported so WoW cards keep one import. */
export { guildHref, memberCountLabel, useMyGuilds, useMyGuildsQuery } from '../../../components/layout/hub-nav/my-hubs-queries';

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

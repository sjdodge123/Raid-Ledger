/**
 * ROK-1928 A4/C3 — the WoW: Forever guild hub's Blizzard roster source: read
 * the slug + last sync outcome, set the slug (editors), run "Sync now".
 * Keys extend `guildPageKey(guildId)` so a page invalidation refreshes them.
 */
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import {
    GuildBlizzardRosterViewSchema,
    type BlizzardRosterStatus,
    type GuildBlizzardRosterView,
    type GuildSummary,
} from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';
import { guildPageKey } from '../../../components/hub/api/use-guild';

/** `POST …/blizzard-roster/sync` → the run's outcome (ROK-1928 C3). */
export interface BlizzardRosterSyncResult {
    status: BlizzardRosterStatus;
    syncedAt: string | null;
    members: number;
}

const rosterUrl = (guildId: number): string => `/plugins/wow/guilds/${guildId}/blizzard-roster`;

/** Query key of the GET; a prefix-match of `guildPageKey(guildId)`. */
export function blizzardRosterKey(guildId: number): readonly unknown[] {
    return [...guildPageKey(guildId), 'blizzard-roster'] as const;
}

/** The hub's Blizzard roster slug, last sync outcome and suggested slug. */
export function useGuildBlizzardRoster(guildId: number, enabled = true): UseQueryResult<GuildBlizzardRosterView, Error> {
    return useQuery({
        queryKey: blizzardRosterKey(guildId),
        queryFn: () => fetchApi(rosterUrl(guildId), {}, GuildBlizzardRosterViewSchema),
        enabled: enabled && guildId > 0,
        staleTime: 60_000,
        retry: false,
    });
}

/** Refresh the roster read and the hub page (members change after a sync). */
function useInvalidateRoster(guildId: number): () => Promise<void> {
    const qc = useQueryClient();
    return () => qc.invalidateQueries({ queryKey: guildPageKey(guildId) });
}

/** PATCH the slug (null = stop syncing). Editors only (server-enforced). */
export function useSetBlizzardRosterSlug(guildId: number): UseMutationResult<GuildSummary, Error, string | null> {
    const invalidate = useInvalidateRoster(guildId);
    return useMutation({
        mutationFn: (guildSlug: string | null) => fetchApi<GuildSummary>(rosterUrl(guildId), {
            method: 'PATCH', body: JSON.stringify({ guildSlug }),
        }),
        onSettled: invalidate,
    });
}

/** "Sync now" — runs the Blizzard roster sync for this hub once. */
export function useSyncBlizzardRoster(guildId: number): UseMutationResult<BlizzardRosterSyncResult, Error, void> {
    const invalidate = useInvalidateRoster(guildId);
    return useMutation({
        mutationFn: () => fetchApi<BlizzardRosterSyncResult>(`${rosterUrl(guildId)}/sync`, { method: 'POST' }),
        onSettled: invalidate,
    });
}

/**
 * Which source the roster footer names: "Blizzard" once the last sync landed,
 * else "LedgerLink". Reuses the GET above — no second fetch path. Only a
 * `wow_guild` hub has the route: the roster widgets also mount on Forever
 * `game_community` hubs, where the GET would 404 on every mount.
 */
export function useRosterVia(guild: Pick<GuildSummary, 'id' | 'kind'>): 'Blizzard' | 'LedgerLink' {
    const { data } = useGuildBlizzardRoster(guild.id, guild.kind === 'wow_guild');
    return data?.status === 'ok' ? 'Blizzard' : 'LedgerLink';
}

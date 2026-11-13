/**
 * ROK-1789 Part B — the Progression tab's query. Idle until a guild id is
 * known; no failure is retried (`retry: false`), so a 403/404 surfaces at once.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { WowGuildProgressionPageDto } from '@raid-ledger/contract';
import { fetchGuildProgression } from './progression-api';

/** The per-hub query key. */
export const guildProgressionKey = (guildId: number) => ['wow-guild-progression', guildId] as const;

/** One guild's Progression page (instances + activity feed). */
export function useGuildProgression(guildId: number): UseQueryResult<WowGuildProgressionPageDto, Error> {
    return useQuery({
        queryKey: guildProgressionKey(guildId),
        queryFn: () => fetchGuildProgression(guildId),
        enabled: guildId > 0,
        retry: false,
        staleTime: 30_000,
    });
}

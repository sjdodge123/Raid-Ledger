/**
 * ROK-2216 — the plan read (ROK-2214 `GET /plugins/wow/guilds/:id/dungeon-plan`):
 * quest readiness for the picked claimed characters in one Forever dungeon.
 * Stateless on the server; the query key carries the whole plan (spec L8).
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { DungeonPlanDto } from '@raid-ledger/contract';
import { useAuth } from '../../../../hooks/use-auth';
import { fetchDungeonPlan } from '../../api-client';

const STALE_MS = 60_000;

/** The plan query key: guild, dungeon and the claimed ids in pick order. */
export function dungeonPlanKey(guildId: number, instanceId: number | null, characterIds: string[]): unknown[] {
    return ['dungeon-plan', guildId, instanceId, characterIds.join(',')];
}

/** The plan for one dungeon + claimed characters; idle until a dungeon is picked (and signed in — the route is jwt-only). */
export function useDungeonPlan(guildId: number, instanceId: number | null, characterIds: string[]): UseQueryResult<DungeonPlanDto, Error> {
    const { isAuthenticated } = useAuth();
    return useQuery({
        queryKey: dungeonPlanKey(guildId, instanceId, characterIds),
        queryFn: () => fetchDungeonPlan(guildId, instanceId ?? 0, characterIds),
        enabled: isAuthenticated && guildId > 0 && instanceId !== null,
        staleTime: STALE_MS,
        retry: false,
    });
}

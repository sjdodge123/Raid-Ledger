/**
 * ROK-2132 — the WoW: Forever join gate's one read: the few public facts a
 * non-member may see (Ruling 1) plus `viewer.isMember` / `hasForeverCharacter`.
 * Keyed under `guildPageKey(guildId)`, so invalidating the page after a claim
 * refetches the gate too; the viewer goes last (ROK-1314).
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { WowGuildJoinGateSchema, type WowGuildJoinGateDto } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';
import { useViewerCacheScope } from '../../../hooks/use-auth';
import { guildPageKey } from '../../../components/hub/api/use-guild';

export function joinGateKey(guildId: number, viewer: unknown): unknown[] {
    return [...guildPageKey(guildId), 'join-gate', viewer];
}

export function useJoinGate(guildId: number): UseQueryResult<WowGuildJoinGateDto, Error> {
    const viewer = useViewerCacheScope();
    return useQuery({
        queryKey: joinGateKey(guildId, viewer),
        queryFn: () => fetchApi(`/plugins/wow/guilds/${guildId}/join-gate`, {}, WowGuildJoinGateSchema),
        enabled: guildId > 0,
        retry: false,
    });
}

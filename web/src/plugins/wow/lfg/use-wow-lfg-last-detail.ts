/**
 * ROK-2352 §3.3 — the caller's last WoW hand detail for a game
 * (`GET /plugins/wow/lfg/:gameId/last-detail`), used to pre-fill the roles.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { z } from 'zod';
import { WowLfgRoleSchema } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api/fetch-api';

const LastDetailSchema = z.object({
    detail: z.object({ roles: z.array(WowLfgRoleSchema), characterId: z.string().nullable() }).nullable(),
});
export type WowLfgLastDetail = z.infer<typeof LastDetailSchema>['detail'];

/** The last detail (null when the caller never raised a WoW hand here). */
export function useWowLfgLastDetail(gameId: number): UseQueryResult<WowLfgLastDetail> {
    return useQuery({
        queryKey: ['lfg', 'wow-last-detail', gameId],
        queryFn: async () => (await fetchApi(`/plugins/wow/lfg/${gameId}/last-detail`, {}, LastDetailSchema)).detail,
        staleTime: 1000 * 60,
    });
}

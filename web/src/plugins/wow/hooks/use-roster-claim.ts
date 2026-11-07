/**
 * ROK-2128 — Add character → "Guild roster".
 * `GET /plugins/wow/roster-claim/candidates?gameId=` lists the unclaimed rows of
 * every visible Forever guild; `POST /plugins/wow/roster-claim/members/:memberId/claim`
 * makes one the caller's character (409 when someone claimed it first).
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import {
    RosterClaimListResponseSchema,
    type CharacterDto,
    type RosterClaimListResponseDto,
    type RosterClaimRequestDto,
} from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';
import { httpStatusOf } from '../../../lib/api/api-error';
import { withoutMember } from '../lib/roster-claim';

/** Query key of one game's candidate list. */
export function rosterClaimCandidatesKey(gameId: number | undefined): readonly unknown[] {
    return ['wow', 'roster-claim', 'candidates', gameId ?? null];
}

/** The unclaimed roster rows of every visible guild of the game (disabled until `enabled`). */
export function useRosterClaimCandidates(gameId: number | undefined, enabled: boolean): UseQueryResult<RosterClaimListResponseDto> {
    return useQuery({
        queryKey: rosterClaimCandidatesKey(gameId),
        queryFn: () => fetchApi(`/plugins/wow/roster-claim/candidates?gameId=${gameId ?? 0}`, {}, RosterClaimListResponseSchema),
        enabled: enabled && !!gameId,
        staleTime: 30_000,
    });
}

export interface ClaimRosterVars {
    memberId: number;
    body: RosterClaimRequestDto;
}

/** Claims one row. A 409 (lost race) drops the row from the cached list before the refetch. */
export function useClaimRosterMember(gameId: number | undefined) {
    const queryClient = useQueryClient();
    const key = rosterClaimCandidatesKey(gameId);
    const dropRow = (memberId: number): void => {
        queryClient.setQueryData<RosterClaimListResponseDto>(key, (old) => (old ? { ...old, guilds: withoutMember(old.guilds, memberId) } : old));
        void queryClient.invalidateQueries({ queryKey: key });
    };
    return useMutation({
        mutationFn: ({ memberId, body }: ClaimRosterVars) => fetchApi<CharacterDto>(
            `/plugins/wow/roster-claim/members/${memberId}/claim`, { method: 'POST', body: JSON.stringify(body) }),
        onSuccess: (_c, { memberId }) => {
            dropRow(memberId);
            void queryClient.invalidateQueries({ queryKey: ['characters'] });
            void queryClient.invalidateQueries({ queryKey: ['me', 'characters'] });
            void queryClient.invalidateQueries({ queryKey: ['userProfile'] });
        },
        onError: (error, { memberId }) => { if (httpStatusOf(error) === 409) dropRow(memberId); },
    });
}

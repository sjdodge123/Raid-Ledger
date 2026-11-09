/**
 * ROK-2128 — Add character → "Guild roster".
 * `GET /plugins/wow/roster-claim/candidates?gameId=&q=&guildId=` lists the unclaimed rows of
 * every visible Forever guild (`q` narrows by name server-side, before the cap; `guildId`
 * narrows to one guild — ROK-2132 Ruling 6); `POST /plugins/wow/roster-claim/members/:memberId/claim`
 * makes one the caller's character (409 when someone claimed it first).
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import {
    RosterClaimListResponseSchema,
    type CharacterDto,
    type RosterClaimListResponseDto,
    type RosterClaimRequestDto,
} from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';
import { httpStatusOf } from '../../../lib/api/api-error';
import { withoutMember } from '../lib/roster-claim';
import { invalidateAllHubMemberships } from '../../../components/hub/community/invalidate-hub-membership';

/** Query-key prefix of one game's candidate lists (every search). */
export function rosterClaimCandidatesKey(gameId: number | undefined): readonly unknown[] {
    return ['wow', 'roster-claim', 'candidates', gameId ?? null];
}

/**
 * The candidates URL; a non-blank `q` is sent so the server filters before its cap,
 * and a `guildId` (ROK-2132) narrows the list to that one guild.
 */
export function rosterClaimCandidatesUrl(gameId: number | undefined, q = '', guildId?: number): string {
    const term = q.trim();
    const search = term ? `&q=${encodeURIComponent(term)}` : '';
    const guild = guildId !== undefined ? `&guildId=${guildId}` : '';
    return `/plugins/wow/roster-claim/candidates?gameId=${gameId ?? 0}${search}${guild}`;
}

/** The unclaimed roster rows of every visible guild of the game, or of one guild (disabled until `enabled`). */
export function useRosterClaimCandidates(gameId: number | undefined, enabled: boolean, q = '', guildId?: number): UseQueryResult<RosterClaimListResponseDto> {
    return useQuery({
        queryKey: [...rosterClaimCandidatesKey(gameId), q.trim(), guildId ?? null],
        queryFn: () => fetchApi(rosterClaimCandidatesUrl(gameId, q, guildId), {}, RosterClaimListResponseSchema),
        enabled: enabled && !!gameId,
        staleTime: 30_000,
        placeholderData: keepPreviousData,
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
        queryClient.setQueriesData<RosterClaimListResponseDto>({ queryKey: key }, (old) => (old ? { ...old, guilds: withoutMember(old.guilds, memberId) } : old));
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
            // Codex P2: a GUID-backed claim makes the player a guild member at once.
            void invalidateAllHubMemberships(queryClient);
        },
        onError: (error, { memberId }) => { if (httpStatusOf(error) === 409) dropRow(memberId); },
    });
}

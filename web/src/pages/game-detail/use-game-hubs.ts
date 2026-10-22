/**
 * ROK-1870 — the game page Hubs card: its read (`GET /hubs/by-game/:gameId`,
 * key `['game-hubs', gameId, viewer]`), the optimistic inline Join, proposal
 * submit and proposal withdraw.
 * ROK-1883: the payload carries per-viewer WoW / server membership (and the
 * staff-only `hidden` flag), so the key ends in the viewer scope (ROK-1314) —
 * a sign-out + sign-in never shows the previous viewer's rows.
 */
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import {
    GameHubsSchema,
    HubProposalSchema,
    type CommunityHubJoinResponse,
    type CreateHubProposalDto,
    type GameHubs,
    type HubProposal,
} from '@raid-ledger/contract';
import { fetchApi } from '../../lib/api/fetch-api';
import { toast } from '../../lib/toast';
import { useViewerCacheScope } from '../../hooks/use-auth';
import { invalidateHubMembership } from '../../components/hub/community/invalidate-hub-membership';
import { requestHubJoin, withJoin } from './hub-join';

/** The viewer scope a key ends in (`useViewerCacheScope`). */
type ViewerScope = number | 'anon';

/** Query key for one game's Hubs card, as one viewer sees it. */
export function gameHubsKey(gameId: number, viewer: ViewerScope): readonly ['game-hubs', number, ViewerScope] {
    return ['game-hubs', gameId, viewer];
}

/** Every game's card — the D12 proposal limit is global, so a submit/withdraw changes them all. */
const ALL_GAME_HUBS = ['game-hubs'] as const;

/** Read the game's hubs, the viewer's proposals and whether they may propose. */
export function useGameHubs(gameId: number): UseQueryResult<GameHubs> {
    return useQuery({
        queryKey: gameHubsKey(gameId, useViewerCacheScope()),
        queryFn: () => fetchApi(`/hubs/by-game/${gameId}`, {}, GameHubsSchema),
    });
}

interface JoinContext { previous: GameHubs | undefined }

function patchHub(data: GameHubs, hubId: number, memberCount?: number): GameHubs {
    return { ...data, hubs: data.hubs.map((h) => (h.id === hubId ? withJoin(h, true, memberCount) : h)) };
}

/** Optimistic inline Join from the card; rolls back + toasts on error. */
export function useJoinGameHub(gameId: number): UseMutationResult<CommunityHubJoinResponse, Error, number, JoinContext> {
    const qc = useQueryClient();
    const key = gameHubsKey(gameId, useViewerCacheScope());
    return useMutation<CommunityHubJoinResponse, Error, number, JoinContext>({
        mutationFn: (hubId) => requestHubJoin(hubId, true),
        onMutate: async (hubId) => {
            await qc.cancelQueries({ queryKey: key });
            const previous = qc.getQueryData<GameHubs>(key);
            if (previous) qc.setQueryData<GameHubs>(key, patchHub(previous, hubId));
            return { previous };
        },
        onSuccess: (res, hubId) => {
            qc.setQueryData<GameHubs>(key, (d) => (d ? patchHub(d, hubId, res.memberCount) : d));
        },
        onError: (err, _hubId, ctx) => {
            if (ctx?.previous) qc.setQueryData(key, ctx.previous);
            toast.error(err.message);
        },
        onSettled: (_res, _err, hubId) => invalidateHubMembership(qc, hubId),
    });
}

/** Withdraw one of the viewer's pending proposals (refreshes every game card). */
export function useWithdrawProposal(): UseMutationResult<void, Error, number> {
    const qc = useQueryClient();
    return useMutation<void, Error, number>({
        mutationFn: (proposalId) => fetchApi<void>(`/hubs/proposals/${proposalId}`, { method: 'DELETE' }),
        onSuccess: () => toast.success('Proposal withdrawn'),
        onError: (err) => toast.error(err.message),
        onSettled: () => void qc.invalidateQueries({ queryKey: ALL_GAME_HUBS }),
    });
}

/** Submit a proposal; on success the card's "Your proposals" gains the row. */
export function useProposeHub(gameId: number): UseMutationResult<HubProposal, Error, CreateHubProposalDto> {
    const qc = useQueryClient();
    const key = gameHubsKey(gameId, useViewerCacheScope());
    return useMutation<HubProposal, Error, CreateHubProposalDto>({
        mutationFn: (body) => fetchApi('/hubs/proposals', { method: 'POST', body: JSON.stringify(body) }, HubProposalSchema),
        onSuccess: (proposal) => {
            qc.setQueryData<GameHubs>(key, (d) => (d ? { ...d, myProposals: [...d.myProposals, proposal] } : d));
            toast.success('Sent for review');
            void qc.invalidateQueries({ queryKey: ALL_GAME_HUBS });
        },
    });
}

/**
 * ROK-1870 — the game page "Community hubs" card: its read
 * (`GET /hubs/by-game/:gameId`, key `['game-hubs', gameId]`), the optimistic
 * inline Join, proposal submit and proposal withdraw.
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
import { requestHubJoin, withJoin } from './hub-join';

/** Query key for one game's community hubs card. */
export function gameHubsKey(gameId: number): readonly ['game-hubs', number] {
    return ['game-hubs', gameId];
}

/** Read the game's hubs, the viewer's proposals and whether they may propose. */
export function useGameHubs(gameId: number): UseQueryResult<GameHubs> {
    return useQuery({
        queryKey: gameHubsKey(gameId),
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
    const key = gameHubsKey(gameId);
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
        onSettled: () => void qc.invalidateQueries({ queryKey: key }),
    });
}

/** Withdraw one of the viewer's pending proposals. */
export function useWithdrawProposal(gameId: number): UseMutationResult<void, Error, number> {
    const qc = useQueryClient();
    return useMutation<void, Error, number>({
        mutationFn: (proposalId) => fetchApi<void>(`/hubs/proposals/${proposalId}`, { method: 'DELETE' }),
        onSuccess: () => toast.success('Proposal withdrawn'),
        onError: (err) => toast.error(err.message),
        onSettled: () => void qc.invalidateQueries({ queryKey: gameHubsKey(gameId) }),
    });
}

/** Submit a proposal; on success the card's "Your proposals" gains the row. */
export function useProposeHub(gameId: number): UseMutationResult<HubProposal, Error, CreateHubProposalDto> {
    const qc = useQueryClient();
    const key = gameHubsKey(gameId);
    return useMutation<HubProposal, Error, CreateHubProposalDto>({
        mutationFn: (body) => fetchApi('/hubs/proposals', { method: 'POST', body: JSON.stringify(body) }, HubProposalSchema),
        onSuccess: (proposal) => {
            qc.setQueryData<GameHubs>(key, (d) => (d ? { ...d, myProposals: [...d.myProposals, proposal] } : d));
            toast.success('Sent for review');
            void qc.invalidateQueries({ queryKey: key });
        },
    });
}

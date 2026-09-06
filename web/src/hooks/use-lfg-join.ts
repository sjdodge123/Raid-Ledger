/**
 * Raising a hand for a game (ROK-1453).
 *
 * Shared by every surface that can create an intent — the cold-start prompt
 * today, ROK-1464's group page next — so that they all invalidate the same
 * cache prefix. `['lfg']` covers the group list behind the tile chips, the
 * events banner count, the per-game detail read and the hearted list the
 * prompt itself is built from (the server drops a game from that list once the
 * caller holds a live intent on it).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { LfgNowTtl, LfgUrgency } from '@raid-ledger/contract';
import { createIntent } from '../lib/api/lfg-api';
import { toast } from '../lib/toast';

/**
 * What a caller hands the mutation (ROK-1479 D13).
 *
 * It was a bare `number` until urgency existed. It is an object rather than a
 * second hook because a parallel hook would fork the `['lfg']` invalidation
 * prefix this module exists to keep single.
 *
 * `ttlMinutes` must be ABSENT for `urgency: 'week'` — the contract rejects the
 * pair (A2), so surfaces spread a pick object that simply has no such key.
 */
export interface JoinGroupVars {
    /** Game to raise a hand for. */
    gameId: number;
    /** Omitted means the server's `week` default. */
    urgency?: LfgUrgency;
    /** Only meaningful with `urgency: 'now'`; absent there means 30. */
    ttlMinutes?: LfgNowTtl;
}

/**
 * Mutation that posts `POST /lfg` for a game and refreshes every LFG read.
 *
 * @param onJoined - Called with the game id after the intent is created, for
 *   surfaces that want to confirm the action inline.
 */
export function useJoinGroup(onJoined?: (gameId: number) => void) {
    const queryClient = useQueryClient();

    return useMutation<void, Error, JoinGroupVars>({
        mutationFn: async (vars: JoinGroupVars) => {
            await createIntent(vars);
        },
        onSuccess: (_data, vars) => {
            queryClient.invalidateQueries({ queryKey: ['lfg'] });
            onJoined?.(vars.gameId);
        },
        onError: () => toast.error('Failed to join the group'),
    });
}

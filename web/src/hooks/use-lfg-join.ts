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
import { errorBodyOf, httpStatusOf } from '../lib/api/api-error';

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
    /** ROK-2352: one hand per key, posted in order; absent/empty = the whole-game group. */
    groupKeys?: readonly string[];
    /** ROK-2352: the plugin's hand detail, sent with every hand. */
    handDetail?: Record<string, unknown>;
}

/** Live hands one person may hold per game (Q2) — the server's cap, mirrored for the picker. */
export const LFG_HAND_CAP = 5;

/** Shown when the server refuses a hand over the per-game cap (400 + {@link LFG_HAND_CAP_CODE}, Q2). */
export const LFG_HAND_CAP_COPY = 'You can be in up to 5 groups for this game';

/** The machine `code` on the server's cap refusal (`api/src/lfg/lfg.constants.ts`). */
export const LFG_HAND_CAP_CODE = 'LFG_HAND_CAP';

/**
 * One `POST /lfg` per group key, sequential, stopping at the first error so a
 * cap refusal never leaves later picks half-raised. The whole-game group (and
 * every non-grouped game) posts the pre-ROK-2352 body: no `groupKey` key.
 */
export async function raiseHands(vars: JoinGroupVars): Promise<void> {
    const { groupKeys, handDetail, ...base } = vars;
    const keys = groupKeys && groupKeys.length > 0 ? groupKeys : [''];
    for (const key of keys) {
        await createIntent({
            ...base,
            ...(key === '' ? {} : { groupKey: key }),
            ...(handDetail ? { handDetail } : {}),
        });
    }
}

/** The cap refusal is a 400 carrying its own code; any other 400 is a plain failure. */
export function isHandCapError(error: unknown): boolean {
    return httpStatusOf(error) === 400 && errorBodyOf(error)?.code === LFG_HAND_CAP_CODE;
}

function joinErrorCopy(error: Error): string {
    return isHandCapError(error) ? LFG_HAND_CAP_COPY : 'Failed to join the group';
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
        mutationFn: raiseHands,
        onSuccess: (_data, vars) => onJoined?.(vars.gameId),
        // Settled, not success: a multi-pick that stops on a refusal has already
        // raised the earlier hands, and the page must show them (review r1).
        onSettled: () => queryClient.invalidateQueries({ queryKey: ['lfg'] }),
        onError: (error) => toast.error(joinErrorCopy(error)),
    });
}

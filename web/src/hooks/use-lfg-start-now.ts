/**
 * ROK-1613 — "Start playing now": mint the group's ad-hoc session on demand,
 * without waiting for `LFG_NOW_SPAWN_THRESHOLD` now-hands to appear.
 *
 * `POST /lfg/:gameId/start-now` does the whole job server-side (spawn or
 * attach, roster the starter, invite every other +1), so there is no second
 * call to sequence here — unlike lock-in, which creates an event and then
 * reports provenance.
 *
 * `spawned: false` means the press ATTACHED to a session already live on the
 * game (AC5). That is a success: the starter is on the roster either way, and
 * toasting it as a failure would tell the truthful half of a lie.
 */
import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { LfgStartNowResponseDto } from '@raid-ledger/contract';
import { startNowSession } from '../lib/api/lfg-api';
import { toast } from '../lib/toast';
import { LFG_COPY } from '../pages/lfg/lfg-copy';

export interface StartNowOptions {
    /** Runs after the session exists and the reads were invalidated. */
    onSettled?: () => void;
}

/**
 * Start the LFG group for `gameId` playing right now.
 *
 * Invalidates every `['lfg']` read (the detail's `playingNow` is what flips
 * the page into the session state) and every `['events']` read (the ad-hoc
 * event is new on the calendar), exactly as lock-in does.
 */
export function useStartNow(gameId: number) {
    const queryClient = useQueryClient();
    const mutation = useMutation({
        mutationFn: (): Promise<LfgStartNowResponseDto> => startNowSession(gameId),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ['lfg'] });
            void queryClient.invalidateQueries({ queryKey: ['events'] });
        },
        onError: (error: Error) =>
            toast.error(error.message || LFG_COPY.startNowFailed),
    });
    const { mutate } = mutation;
    /**
     * `onSettled`, not `onSuccess`: the confirm dialog must close on a refusal
     * too (AC6's 403), otherwise a non-participant who reaches the dialog is
     * left staring at a spinner that already finished.
     */
    const startNow = useCallback(
        (options?: StartNowOptions): void =>
            mutate(undefined, { onSettled: options?.onSettled }),
        [mutate],
    );
    return { startNow, isPending: mutation.isPending };
}

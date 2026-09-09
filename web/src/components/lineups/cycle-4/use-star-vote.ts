/**
 * Top-pick ("star") state for the voting composite — ROK-1474.
 *
 * Lives outside `VotingComposite.tsx` deliberately: that file is at 269 of
 * its 300 permitted lines, so the handler, the optimistic invariant and the
 * toasts are owned here and the composite only wires them.
 *
 * The invariant this hook exists to hold: **one star per voter**. The server
 * enforces it with a partial unique index; locally we must not render two
 * pressed stars for the round-trip between click and refetch, so the click
 * result is applied optimistically and handed back to the server value once a
 * fresh `myTopPickGameId` arrives.
 *
 * Stars are private until the outcome (operator ruling, 2026-09-05): this
 * hook therefore knows only the viewer's own pick and never a tally.
 */
import { useState } from 'react';
import { useSetStar } from '../../../hooks/use-lineups';
import { toast } from '../../../lib/toast';

/** Arguments for {@link useStarVote}. */
export interface UseStarVoteArgs {
    /** Lineup being voted on. */
    lineupId: number;
    /** The viewer's top pick as the server last reported it. */
    serverTopPickGameId: number | null;
    /** False when starring is closed (hold open, private non-invitee). */
    enabled: boolean;
}

/** What {@link useStarVote} hands the composite. */
export interface StarVoteState {
    /** The pick to render — optimistic while a mutation is in flight. */
    myTopPickGameId: number | null;
    /** Star the game, or clear the star when it is already the pick. */
    toggleStar: (gameId: number) => void;
}

/**
 * Own the star mutation and the single-star optimistic invariant.
 *
 * Re-clicking the current pick clears it (`gameId: null` on the wire) — a
 * voter may star nothing (AC1), so "clear" is a first-class action rather
 * than an unreachable state.
 */
export function useStarVote(args: UseStarVoteArgs): StarVoteState {
    const { lineupId, serverTopPickGameId, enabled } = args;
    const setStar = useSetStar();
    // `undefined` = no local opinion; `null` = locally cleared.
    const [optimistic, setOptimistic] = useState<number | null | undefined>(
        undefined,
    );
    // React 18 "reset state when the prop changes" pattern (the same one the
    // composite uses for `submittedAt`): a fresh server value always wins, so
    // an invalidated refetch cannot be overridden by a stale local guess.
    const [prevServer, setPrevServer] = useState(serverTopPickGameId);
    if (serverTopPickGameId !== prevServer) {
        setPrevServer(serverTopPickGameId);
        setOptimistic(undefined);
    }

    const current = optimistic === undefined ? serverTopPickGameId : optimistic;

    const toggleStar = (gameId: number): void => {
        if (!enabled) return;
        const next = current === gameId ? null : gameId;
        setOptimistic(next);
        setStar.mutate(
            { lineupId, gameId: next },
            {
                onSuccess: () =>
                    toast.success(
                        next === null ? 'Top pick cleared' : 'Top pick saved',
                    ),
                onError: (err) => {
                    setOptimistic(undefined); // roll back to the server truth
                    toast.error(
                        err instanceof Error
                            ? err.message
                            : 'Could not save your top pick',
                    );
                },
            },
        );
    };

    return { myTopPickGameId: current, toggleStar };
}

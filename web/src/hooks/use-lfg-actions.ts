/**
 * ROK-1464 — the LFG group page's write paths.
 *
 * D8 dedupe: `useJoinGroup` is ROK-1453's (`use-lfg-join.ts`) — it already
 * invalidates the same `['lfg']` prefix, so this module carries only the
 * writes the group page introduced.
 *
 * `Find a time` (D3/D4) is three non-atomic calls:
 *   1. `POST /scheduling-polls`      — the poll now EXISTS.
 *   2. `POST …/suggest`  (optional)  — seeds the picked overlap window.
 *   3. `POST /lfg/:id/convert`       — provenance only.
 * Steps 2 and 3 can fail after step 1 has succeeded, so neither failure may
 * discard the poll: a failed seed is a toast, a failed convert parks the poll
 * in `pendingConvert` so the page can offer both the link and a retry.
 */
import { useCallback, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { createSchedulingPoll, suggestSlot } from '../lib/api-client';
import { convertIntents, withdrawIntent } from '../lib/api/lfg-api';
import { toast } from '../lib/toast';
import { LFG_COPY } from '../pages/lfg/lfg-copy';

/** How long a Find-a-time poll stays open before auto-archiving (D3). */
const POLL_DURATION_HOURS = 2;

export interface FindATimeArgs {
    gameId: number;
    /** The live roster, viewer included — they become the poll's members. */
    memberUserIds: number[];
    /** `window.start` when the viewer started from an overlap row (D4). */
    proposedTime?: string;
}

/** A poll that exists but whose group was never marked as converted. */
export interface PendingConvert {
    gameId: number;
    lineupId: number;
    matchId: number;
}

/** Withdraw the viewer's own intent. */
export function useWithdraw() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (gameId: number) => withdrawIntent(gameId),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ['lfg'] });
        },
        onError: (error: Error) => toast.error(error.message),
    });
}

/**
 * Seed the poll's first slot. Non-fatal by construction (D4): the poll is
 * already usable without it, so a rejection is reported and swallowed.
 */
async function trySeedSlot(
    poll: { id: number; lineupId: number },
    proposedTime: string,
): Promise<void> {
    try {
        await suggestSlot(poll.lineupId, poll.id, proposedTime);
    } catch {
        toast.error(LFG_COPY.suggestFailed);
    }
}

/** Create the poll and (optionally) seed it with the picked window. */
async function createPoll(args: FindATimeArgs): Promise<PendingConvert> {
    const poll = await createSchedulingPoll({
        gameId: args.gameId,
        memberUserIds: args.memberUserIds,
        durationHours: POLL_DURATION_HOURS,
        minVoteThreshold: args.memberUserIds.length,
    });
    if (args.proposedTime) await trySeedSlot(poll, args.proposedTime);
    return { gameId: args.gameId, lineupId: poll.lineupId, matchId: poll.id };
}

/**
 * The convert step, isolated so its failure story lives in one place: park the
 * poll, tell the viewer, and DON'T navigate — the page keeps the link.
 */
function useFinishConvert(
    setPendingConvert: (poll: PendingConvert | null) => void,
): (poll: PendingConvert) => Promise<void> {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    return useCallback(
        async (poll: PendingConvert): Promise<void> => {
            try {
                await convertIntents(poll.gameId, { pollId: poll.matchId });
            } catch {
                setPendingConvert(poll);
                toast.error(LFG_COPY.convertFailed);
                return;
            }
            setPendingConvert(null);
            void queryClient.invalidateQueries({ queryKey: ['lfg'] });
            navigate(
                `/community-lineup/${poll.lineupId}/schedule/${poll.matchId}`,
            );
        },
        [navigate, queryClient, setPendingConvert],
    );
}

/**
 * The Find-a-time flow. Returns the poll parked by a failed convert so the
 * page can render the link plus a retry rather than losing it.
 */
export function useFindATime() {
    const [pendingConvert, setPendingConvert] = useState<PendingConvert | null>(
        null,
    );
    const finish = useFinishConvert(setPendingConvert);

    const mutation = useMutation({
        mutationFn: createPoll,
        onSuccess: finish,
        onError: (error: Error) =>
            toast.error(error.message || LFG_COPY.findATimeFailed),
    });

    const retryConvert = useCallback(async (): Promise<void> => {
        if (pendingConvert) await finish(pendingConvert);
    }, [finish, pendingConvert]);

    return {
        findATime: mutation.mutate,
        isPending: mutation.isPending,
        pendingConvert,
        retryConvert,
    };
}

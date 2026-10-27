/**
 * Remove a participant from a scheduling poll (ROK-2020).
 *
 * Optimistic: the person leaves this poll's cached roster at once; an error
 * restores the snapshot and toasts the API's own copy (400 poll closed /
 * creator, 403 not allowed, 404 not on the poll). Settled — either way — the
 * poll page (leading time, slot counts, "N still to vote"), its tallies and
 * the roster refetch via {@link invalidatePollViews}.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { LineupParticipantsResponseDto } from '@raid-ledger/contract';
import { toast } from '../lib/toast';
import { removePollMember } from '../lib/api-client';
import { PARTICIPANTS_KEY } from './use-lineups';
import { invalidatePollViews } from './use-scheduling';

export interface RemovePollMemberVars {
  lineupId: number;
  matchId: number;
  userId: number;
  /** For the success toast only. */
  displayName: string;
}

interface RemoveContext {
  previous: LineupParticipantsResponseDto | undefined;
}

type RemoveResult = { removedVotes: number; memberCount: number };

const rosterKey = (lineupId: number, matchId: number) =>
  [...PARTICIPANTS_KEY, lineupId, matchId] as const;

/** See file docstring. */
export function useRemovePollMember() {
  const qc = useQueryClient();
  return useMutation<RemoveResult, Error, RemovePollMemberVars, RemoveContext>({
    mutationFn: ({ lineupId, matchId, userId }) =>
      removePollMember(lineupId, matchId, userId),
    onMutate: async ({ lineupId, matchId, userId }) => {
      const key = rosterKey(lineupId, matchId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<LineupParticipantsResponseDto>(key);
      if (previous) {
        qc.setQueryData<LineupParticipantsResponseDto>(key, {
          ...previous,
          participants: previous.participants.filter((p) => p.userId !== userId),
        });
      }
      return { previous };
    },
    onError: (err, { lineupId, matchId }, ctx) => {
      if (ctx?.previous) qc.setQueryData(rosterKey(lineupId, matchId), ctx.previous);
      toast.error(err.message || 'Failed to remove participant');
    },
    onSuccess: (_res, { displayName }) => {
      toast.success(`Removed ${displayName} from this poll`);
    },
    onSettled: (_res, _err, { lineupId, matchId }) => {
      invalidatePollViews(qc, lineupId, matchId);
    },
  });
}

/**
 * TanStack mutations for the U4 SubmitBar (ROK-1296).
 *
 * One mutation, `useSubmitVotes`, that mirrors the `useNominateGame` /
 * `useToggleVote` pattern in `use-lineups.ts` — it invalidates
 * `LINEUPS_PREFIX` on success so the lineup detail refetches and the
 * SubmitBar flips to `post` kind via `viewerSubmissions.votesSubmittedAt`.
 *
 * `useSubmitScheduling` was retired by ROK-1544 (the server stamps
 * `schedulingSubmittedAt` from the vote itself); the nominations submit
 * hook had no caller left and is gone too.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { LineupDetailResponseDto } from '@raid-ledger/contract';
import { submitVotes } from '../lib/api/lineup-submit-api';
import { LINEUPS_PREFIX } from './use-lineups';

/** Submit votes for a lineup (AC2b). */
export function useSubmitVotes() {
  const qc = useQueryClient();
  return useMutation<LineupDetailResponseDto, Error, { lineupId: number }>({
    mutationFn: ({ lineupId }) => submitVotes(lineupId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...LINEUPS_PREFIX] });
    },
  });
}

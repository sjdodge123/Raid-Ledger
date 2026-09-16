/**
 * TanStack mutations for the U4 SubmitBar (ROK-1296).
 *
 * Two mutations that mirror the `useNominateGame` / `useToggleVote`
 * pattern in `use-lineups.ts` — each invalidates `LINEUPS_PREFIX` on
 * success so the lineup detail refetches and the SubmitBar flips to
 * `post` kind via `viewerSubmissions.*SubmittedAt`.
 *
 * The third, `useSubmitScheduling`, is retired by ROK-1544 — the scheduling
 * surface has no member Submit; the server stamps `schedulingSubmittedAt`
 * from the vote itself.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { LineupDetailResponseDto } from '@raid-ledger/contract';
import { submitNominations, submitVotes } from '../lib/api/lineup-submit-api';
import { LINEUPS_PREFIX } from './use-lineups';

/** Submit nominations for a lineup (AC2a). */
export function useSubmitNominations() {
  const qc = useQueryClient();
  return useMutation<LineupDetailResponseDto, Error, { lineupId: number }>({
    mutationFn: ({ lineupId }) => submitNominations(lineupId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...LINEUPS_PREFIX] });
    },
  });
}

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

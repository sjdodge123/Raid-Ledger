/**
 * Sorted Sv voting leaderboard (ROK-1298).
 *
 * Renders one {@link VotingRow} per entry, sorted by `voteCount` desc
 * with `ownerCount` desc as the tiebreaker — matching the legacy
 * `VotingLeaderboard` sort. The denominator (always
 * `lineup.votingEligibleCount`) is passed through to each row; the row
 * itself never derives it.
 *
 * Per-row toggle handlers are passed in from the composite, which owns
 * the `useToggleVote` mutation + the drawer open state.
 */
import { useMemo, type JSX } from 'react';
import type { LineupEntryResponseDto } from '@raid-ledger/contract';
import { VotingRow } from './VotingRow';

/** Props for {@link VotingLeaderboardV2}. */
export interface VotingLeaderboardV2Props {
  /** Entries to render — sorted internally; caller may pass unsorted. */
  entries: LineupEntryResponseDto[];
  /** Game IDs the viewer has voted for. */
  myVotes: number[];
  /** Bar denominator — `lineup.votingEligibleCount`. */
  voterDenominator: number;
  /**
   * True when the viewer is at the per-user vote cap AND has not voted
   * for an unvoted entry. Drives the unvoted-row disable.
   */
  atLimit: boolean;
  /** When false, every row is disabled (private non-invitee, etc). */
  canParticipate: boolean;
  /** Per-entry vote toggle handler. */
  onToggleVote: (gameId: number) => void;
  /** Per-entry drawer-open handler. */
  onOpenDrawer: (gameId: number) => void;
}

/** Sort entries by voteCount desc, with ownerCount desc as tiebreaker. */
function sortByVotes(
  entries: LineupEntryResponseDto[],
): LineupEntryResponseDto[] {
  return [...entries].sort((a, b) => {
    if (b.voteCount !== a.voteCount) return b.voteCount - a.voteCount;
    return b.ownerCount - a.ownerCount;
  });
}

/** Sorted Sv voting leaderboard — see file-level docstring. */
export function VotingLeaderboardV2(
  props: VotingLeaderboardV2Props,
): JSX.Element {
  const {
    entries,
    myVotes,
    voterDenominator,
    atLimit,
    canParticipate,
    onToggleVote,
    onOpenDrawer,
  } = props;
  const sorted = useMemo(() => sortByVotes(entries), [entries]);
  const votedSet = useMemo(() => new Set(myVotes), [myVotes]);
  return (
    <div
      data-testid="voting-leaderboard-v2"
      className="bg-surface border border-edge rounded-xl overflow-hidden"
    >
      {sorted.map((entry) => {
        const isVoted = votedSet.has(entry.gameId);
        const rowDisabled = !canParticipate || (atLimit && !isVoted);
        return (
          <VotingRow
            key={entry.id}
            entry={entry}
            isVoted={isVoted}
            disabled={rowDisabled}
            voterDenominator={voterDenominator}
            onToggleVote={() => onToggleVote(entry.gameId)}
            onOpenDrawer={() => onOpenDrawer(entry.gameId)}
          />
        );
      })}
    </div>
  );
}

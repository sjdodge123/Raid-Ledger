/**
 * Sorted Sv voting leaderboard (ROK-1298).
 *
 * Renders one {@link VotingRow} per entry, sorted by `voteCount` desc
 * with `ownerCount` desc as the tiebreaker — matching the legacy
 * `VotingLeaderboard` sort. The denominator (always
 * `lineup.votingEligibleCount`) is passed through to each row; the row
 * itself never derives it.
 *
 * ROK-1401 §2e adds the opt-in "fits our group" sort assist: a header
 * toggle that floats games whose Co-Optimus online co-op cap covers the
 * whole voting group. It is dormant — header and all — until at least one
 * entry carries verified co-op data and the group size is known, so an
 * un-synced library renders exactly as it did before. The rules live in
 * `voting-fit-sort.ts`; the rows themselves gain no badge.
 *
 * Per-row toggle handlers are passed in from the composite, which owns
 * the `useToggleVote` mutation + the drawer open state.
 */
import { useMemo, useState, type JSX } from 'react';
import type { LineupEntryResponseDto } from '@raid-ledger/contract';
import { VotingRow } from './VotingRow';
import { anyCoopFitData, sortForLeaderboard } from './voting-fit-sort';

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

/**
 * Header strip carrying the co-op sort assist. Only mounted when there is
 * data to sort by — see the file docstring on dormancy.
 */
function FitSortHeader({
  groupSize,
  active,
  onToggle,
}: {
  groupSize: number;
  active: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <div
      data-testid="voting-leaderboard-header"
      className="bg-panel/40 px-4 py-2 flex items-center justify-between gap-2"
    >
      <span className="text-xs uppercase tracking-wider text-muted">
        Leaderboard
      </span>
      <button
        type="button"
        data-testid="coop-fit-sort-toggle"
        aria-pressed={active}
        aria-label={`Sort games that fit all ${groupSize} players first`}
        onClick={onToggle}
        className={`px-2 py-0.5 text-[11px] font-semibold rounded whitespace-nowrap transition-colors ${
          active
            ? 'bg-teal-500/90 text-white'
            : 'bg-transparent text-muted hover:text-white border border-edge'
        }`}
      >
        👥 Fits our group
      </button>
    </div>
  );
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
  const [fitsFirst, setFitsFirst] = useState(false);
  const canAssist = useMemo(
    () => voterDenominator > 0 && anyCoopFitData(entries),
    [entries, voterDenominator],
  );
  const sorted = useMemo(
    () =>
      sortForLeaderboard(entries, {
        fitsFirst: fitsFirst && canAssist,
        groupSize: voterDenominator,
      }),
    [entries, fitsFirst, canAssist, voterDenominator],
  );
  const votedSet = useMemo(() => new Set(myVotes), [myVotes]);
  return (
    <div
      data-testid="voting-leaderboard-v2"
      className="bg-surface border border-edge rounded-xl overflow-hidden"
    >
      {canAssist && (
        <FitSortHeader
          groupSize={voterDenominator}
          active={fitsFirst}
          onToggle={() => setFitsFirst((on) => !on)}
        />
      )}
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

/**
 * Single leaderboard row for the Sv Voting composite (ROK-1298).
 *
 * Per-row interaction matrix (spec §"Behavior Specifications"):
 *   - Tap the row body (cover, name, bar area)  → opens U2 drawer
 *   - Tap the vote circle                       → toggles the vote
 *   - The circle's `onClick` calls `stopPropagation()` so the two
 *     affordances never collide.
 *
 * Accessibility (canonical Cycle 4 fix lives here):
 *   - Row body: `role="button"` + `tabIndex=0` + `aria-haspopup="dialog"`
 *     + `aria-label="Open details for ${gameName}"`. Enter / Space activate.
 *   - Vote circle: see {@link VoteToggleButton}.
 *
 * Vote bar normalized to `voterDenominator` (always
 * `lineup.votingEligibleCount`), never derived inside the row.
 */
import type { JSX, KeyboardEvent } from 'react';
import type { LineupEntryResponseDto } from '@raid-ledger/contract';
import { voteBarPct } from './voting-bar.helpers';
import { VoteToggleButton } from './VoteToggleButton';

/** Props for {@link VotingRow}. */
export interface VotingRowProps {
  /** Entry row (game + vote count + ownership). */
  entry: LineupEntryResponseDto;
  /** Has the current viewer voted for this entry? */
  isVoted: boolean;
  /** Disable both vote-circle clicks AND the row body drawer trigger. */
  disabled: boolean;
  /**
   * Bar denominator. Always `lineup.votingEligibleCount` — never derived
   * inside the row. Passed from the leaderboard parent.
   */
  voterDenominator: number;
  /** Fires when the vote circle is activated. */
  onToggleVote: () => void;
  /** Fires when the row body is activated (open the GameResearchDrawer). */
  onOpenDrawer: () => void;
}

/** Cover image (or placeholder) for the row. */
function RowCover({
  url,
}: {
  url: string | null;
}): JSX.Element {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        aria-hidden="true"
        className="w-8 h-10 rounded bg-panel border border-edge-subtle flex-shrink-0 object-cover"
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className="w-8 h-10 rounded bg-panel border border-edge-subtle flex-shrink-0"
    />
  );
}

/** Vote bar with normalized fill width + "X/N" label. */
function VoteBar({
  voteCount,
  voterDenominator,
}: {
  voteCount: number;
  voterDenominator: number;
}): JSX.Element {
  const pct = voteBarPct(voteCount, voterDenominator);
  // Floor: at low fractions (e.g. 1/114 = 0.88%) the rounded `pct` collapses
  // to a sub-pixel sliver that's invisible against the track. When at least
  // one vote exists, show a min 4% fill so the bar communicates "non-zero"
  // before the user has to read the X/N label. Real ratio is still the
  // numeric label; this is purely visual readability.
  const visibleWidth = voteCount > 0 ? Math.max(pct, 4) : 0;
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <div className="flex-1 h-2 bg-overlay/60 rounded-full overflow-hidden">
        <div
          data-testid="vote-bar-fill"
          className="h-full bg-emerald-500 rounded-full"
          style={{ width: `${visibleWidth}%` }}
          data-pct={pct}
        />
      </div>
      <span className="text-[11px] text-muted w-10 text-right tabular-nums">
        {voteCount}/{voterDenominator}
      </span>
    </div>
  );
}

/** Activate the row body (drawer trigger) on Enter/Space. */
function rowKeyHandler(
  onActivate: () => void,
  disabled: boolean,
) {
  return (e: KeyboardEvent<HTMLDivElement>): void => {
    if (disabled) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onActivate();
    }
  };
}

/** Single Sv voting row — see file-level docstring. */
export function VotingRow(props: VotingRowProps): JSX.Element {
  const {
    entry,
    isVoted,
    disabled,
    voterDenominator,
    onToggleVote,
    onOpenDrawer,
  } = props;
  const rowDisabled = disabled;
  const handleRowClick = (): void => {
    if (!rowDisabled) onOpenDrawer();
  };
  return (
    <div
      data-testid="voting-row"
      data-voted={isVoted ? 'true' : 'false'}
      role="button"
      tabIndex={rowDisabled ? -1 : 0}
      aria-label={`Open details for ${entry.gameName}`}
      aria-haspopup="dialog"
      onClick={handleRowClick}
      onKeyDown={rowKeyHandler(onOpenDrawer, rowDisabled)}
      className={`border-b border-edge hover:bg-panel/30 transition-colors relative focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500 ${rowDisabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      {isVoted && (
        <div
          aria-hidden="true"
          className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500"
        />
      )}
      <div className="px-4 py-3 flex items-center gap-3">
        <RowCover url={entry.gameCoverUrl} />
        <div className="flex-1 min-w-0">
          <span className="text-foreground font-semibold text-sm truncate block">
            {entry.gameName}
          </span>
          <VoteBar
            voteCount={entry.voteCount}
            voterDenominator={voterDenominator}
          />
        </div>
        <VoteToggleButton
          gameName={entry.gameName}
          isVoted={isVoted}
          disabled={disabled}
          onToggle={onToggleVote}
        />
      </div>
    </div>
  );
}

/**
 * Single leaderboard row for the Sv Voting composite (ROK-1298 / ROK-1373).
 *
 * Per-row interaction matrix:
 *   - Click the green "Vote" / "Voted" button → toggles the vote.
 *   - Click the cover thumbnail              → opens game details (/games/:id).
 *   - The rest of the row body is NOT a navigation target (ROK-1373: desktop
 *     users were getting yanked to /games/:id when they meant to vote).
 *   - Both controls call `stopPropagation()` so they never collide.
 *
 * Accessibility:
 *   - Vote button: `aria-label="Vote for ${gameName}"` + `aria-pressed`
 *     (see {@link VoteToggleButton}).
 *   - Cover thumbnail: `<button aria-label="View details for ${gameName}">`.
 *
 * Vote bar normalized to `voterDenominator` (always
 * `lineup.votingEligibleCount`), never derived inside the row.
 */
import type { JSX } from 'react';
import type { LineupEntryResponseDto } from '@raid-ledger/contract';
import { voteBarPct } from './voting-bar.helpers';
import { VoteToggleButton } from './VoteToggleButton';

/** Props for {@link VotingRow}. */
export interface VotingRowProps {
  /** Entry row (game + vote count + ownership). */
  entry: LineupEntryResponseDto;
  /** Has the current viewer voted for this entry? */
  isVoted: boolean;
  /** Disable the vote button (private non-invitee, at-limit, etc). */
  disabled: boolean;
  /**
   * Bar denominator. Always `lineup.votingEligibleCount` — never derived
   * inside the row. Passed from the leaderboard parent.
   */
  voterDenominator: number;
  /** Fires when the vote button is activated. */
  onToggleVote: () => void;
  /** Fires when the cover thumbnail is activated (open game details). */
  onOpenDrawer: () => void;
}

/** Cover thumbnail — the explicit "view details" trigger (→ /games/:id). */
function RowCover({
  url,
  gameName,
  onOpenDrawer,
}: {
  url: string | null;
  gameName: string;
  onOpenDrawer: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpenDrawer();
      }}
      aria-label={`View details for ${gameName}`}
      aria-haspopup="dialog"
      className="flex-shrink-0 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500"
    >
      {url ? (
        <img
          src={url}
          alt=""
          aria-hidden="true"
          className="w-8 h-10 rounded bg-panel border border-edge-subtle object-cover"
        />
      ) : (
        <div
          aria-hidden="true"
          className="w-8 h-10 rounded bg-panel border border-edge-subtle"
        />
      )}
    </button>
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
  return (
    <div
      data-testid="voting-row"
      data-voted={isVoted ? 'true' : 'false'}
      className={`border-b border-edge transition-colors relative ${disabled ? 'opacity-80' : ''}`}
    >
      {isVoted && (
        <div
          aria-hidden="true"
          className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500"
        />
      )}
      <div className="px-4 py-3 flex items-center gap-3">
        <RowCover
          url={entry.gameCoverUrl}
          gameName={entry.gameName}
          onOpenDrawer={onOpenDrawer}
        />
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

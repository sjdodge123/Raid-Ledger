/**
 * Leaderboard row for the voting phase (ROK-936).
 * Shows rank, game info, vote bar, and vote toggle.
 */
import type { JSX } from 'react';
import type { LineupEntryResponseDto } from '@raid-ledger/contract';
import { GameInfoBadges } from './GameInfoBadges';

interface LeaderboardRowProps {
  entry: LineupEntryResponseDto;
  rank: number;
  totalVoters: number;
  isVoted: boolean;
  onToggleVote: () => void;
  disabled: boolean;
}

/** Rank badge colors: gold / silver / bronze / default. */
function rankColor(rank: number): string {
  if (rank === 1) return 'text-gold bg-emerald-500/20 border-emerald-500/30';
  if (rank === 2) return 'text-silver bg-emerald-500/10 border-emerald-500/20';
  if (rank === 3) return 'text-bronze bg-panel border-edge';
  return 'text-dim bg-panel border-edge';
}

/** Vote bar percentage label. */
function voteBarPct(voteCount: number, totalVoters: number): number {
  if (totalVoters === 0) return 0;
  return Math.round((voteCount / totalVoters) * 100);
}

/** Vote count label — singular/plural. */
function voteLabel(count: number): string {
  return count === 1 ? '1 vote' : `${count} votes`;
}

/** Row info section: game name, ownership, price. */
function RowInfo({ entry }: { entry: LineupEntryResponseDto }): JSX.Element {
  return (
    <div className="flex-1 min-w-0">
      <span className="text-foreground font-semibold text-sm truncate block">{entry.gameName}</span>
      <div className="mt-0.5">
        <GameInfoBadges ownerCount={entry.ownerCount} itadCurrentCut={entry.itadCurrentCut} itadCurrentPrice={entry.itadCurrentPrice} playerCount={entry.playerCount} />
      </div>
    </div>
  );
}

/** Vote toggle button: filled checkmark when voted, empty circle otherwise. */
function VoteToggle({ isVoted, disabled, onToggleVote }: {
  isVoted: boolean;
  disabled: boolean;
  onToggleVote: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      data-testid="vote-toggle"
      onClick={(e) => { e.stopPropagation(); onToggleVote(); }}
      disabled={disabled}
      className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
        isVoted
          ? 'bg-emerald-500'
          : 'border-2 border-edge hover:border-emerald-500/50'
      } disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {isVoted && (
        <svg data-testid="vote-checkmark" className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
        </svg>
      )}
    </button>
  );
}

/** Single leaderboard row with rank, thumbnail, info, vote bar, toggle. */
export function LeaderboardRow({
  entry, rank, totalVoters, isVoted, onToggleVote, disabled,
}: LeaderboardRowProps): JSX.Element {
  const pct = voteBarPct(entry.voteCount, totalVoters);

  return (
    <div
      data-testid="leaderboard-row"
      data-voted={isVoted ? 'true' : 'false'}
      role="button"
      tabIndex={0}
      onClick={disabled ? undefined : onToggleVote}
      onKeyDown={(e) => { if (e.key === 'Enter' && !disabled) onToggleVote(); }}
      className={`border-b border-edge hover:bg-panel/30 transition-colors relative ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      {isVoted && <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500" />}
      <div className="px-4 py-3 flex items-center gap-3">
        <div className={`w-8 h-8 rounded-lg border flex items-center justify-center flex-shrink-0 ${rankColor(rank)}`}>
          <span className="font-black text-sm">{rank}</span>
        </div>
        {entry.gameCoverUrl ? (
          <img src={entry.gameCoverUrl} alt="" className="w-8 h-10 rounded bg-panel border border-edge-subtle flex-shrink-0 object-cover" />
        ) : (
          <div className="w-8 h-10 rounded bg-panel border border-edge-subtle flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <RowInfo entry={entry} />
          <div className="mt-1.5 flex items-center gap-2">
            <div className="flex-1 h-3 bg-panel rounded overflow-hidden">
              <div
                className={`h-full rounded ${isVoted ? 'bg-gradient-to-r from-emerald-600 to-emerald-400' : 'bg-muted/40'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className={`text-xs font-medium w-12 text-right ${isVoted ? 'text-emerald-400 font-bold' : 'text-muted'}`}>
              {voteLabel(entry.voteCount)}
            </span>
          </div>
        </div>
        <VoteToggle isVoted={isVoted} disabled={disabled} onToggleVote={onToggleVote} />
      </div>
    </div>
  );
}

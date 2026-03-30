/**
 * Podium card for a top-3 game in the decided view (ROK-989).
 * Shows rank badge, game cover, ownership info, price, and laurel wreath for champion.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import type { LineupEntryResponseDto } from '@raid-ledger/contract';
import { GameInfoBadges } from '../GameInfoBadges';

interface PodiumCardProps {
  entry: LineupEntryResponseDto;
  rank: number;
}

/** Rank label and gradient config for podium positions. */
const RANK_CONFIG: Record<number, { label: string; border: string; badge: string }> = {
  1: {
    label: 'Champion',
    border: 'border-yellow-500/60',
    badge: 'bg-gradient-to-r from-yellow-500 to-amber-400 text-black',
  },
  2: {
    label: 'Silver',
    border: 'border-zinc-400/40',
    badge: 'bg-gradient-to-r from-zinc-400 to-zinc-300 text-black',
  },
  3: {
    label: 'Bronze',
    border: 'border-amber-700/40',
    badge: 'bg-gradient-to-r from-amber-700 to-amber-600 text-white',
  },
};


/** Cover image or placeholder. */
function PodiumCover({ entry }: { entry: LineupEntryResponseDto }): JSX.Element {
  return (
    <div className="relative h-32 overflow-hidden rounded-t-lg">
      {entry.gameCoverUrl ? (
        <img src={entry.gameCoverUrl} alt={entry.gameName} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full bg-zinc-800" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-surface/80 to-transparent" />
    </div>
  );
}

/** Single podium placement card with rank badge and game info. */
export function PodiumCard({ entry, rank }: PodiumCardProps): JSX.Element {
  const config = RANK_CONFIG[rank] ?? RANK_CONFIG[3];

  return (
    <div className="relative">
      <Link
        to={`/games/${entry.gameId}`}
        data-testid="podium-card"
        className={`relative z-20 rounded-t-lg border ${config.border} border-b-0 bg-surface overflow-hidden flex flex-col hover:border-emerald-500/50 hover:shadow-lg transition-all`}
      >
        <PodiumCover entry={entry} />
        <div className="px-3 py-2 flex-1 flex flex-col">
          <div className="flex items-center gap-1.5 mb-1">
            <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${config.badge}`}>
              {config.label}
            </span>
          </div>
          <h4 className="text-sm font-semibold text-foreground truncate">{entry.gameName}</h4>
          <span className="text-[11px] text-muted">{entry.voteCount} votes</span>
          <div className="mt-1">
            <GameInfoBadges ownerCount={entry.ownerCount} itadCurrentCut={entry.itadCurrentCut} itadCurrentPrice={entry.itadCurrentPrice} playerCount={entry.playerCount} />
          </div>
        </div>
      </Link>
    </div>
  );
}

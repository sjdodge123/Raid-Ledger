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

/** Laurel wreath SVG that frames the champion card. */
function LaurelWreath(): JSX.Element {
  return (
    <div className="absolute -inset-5 pointer-events-none z-30" data-testid="crown-icon">
      <svg viewBox="0 0 220 220" className="w-full h-full opacity-70" fill="none">
        {/* Left branch — hugs the left edge */}
        <path d="M12 190 C8 150, 4 120, 6 90 C7 70, 5 50, 10 30 C12 22, 18 15, 28 10" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round" />
        {/* Left leaves — pointing inward from the edge */}
        <ellipse cx="4" cy="165" rx="10" ry="4" transform="rotate(-50 4 165)" fill="#fbbf24" opacity="0.5" />
        <ellipse cx="2" cy="140" rx="10" ry="4" transform="rotate(-45 2 140)" fill="#fbbf24" opacity="0.5" />
        <ellipse cx="2" cy="115" rx="9" ry="3.5" transform="rotate(-40 2 115)" fill="#fbbf24" opacity="0.5" />
        <ellipse cx="3" cy="90" rx="9" ry="3.5" transform="rotate(-35 3 90)" fill="#fbbf24" opacity="0.5" />
        <ellipse cx="5" cy="65" rx="8" ry="3" transform="rotate(-30 5 65)" fill="#fbbf24" opacity="0.5" />
        <ellipse cx="8" cy="42" rx="7" ry="3" transform="rotate(-20 8 42)" fill="#fbbf24" opacity="0.5" />
        {/* Right branch — hugs the right edge */}
        <path d="M208 190 C212 150, 216 120, 214 90 C213 70, 215 50, 210 30 C208 22, 202 15, 192 10" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round" />
        {/* Right leaves — pointing inward from the edge */}
        <ellipse cx="216" cy="165" rx="10" ry="4" transform="rotate(50 216 165)" fill="#fbbf24" opacity="0.5" />
        <ellipse cx="218" cy="140" rx="10" ry="4" transform="rotate(45 218 140)" fill="#fbbf24" opacity="0.5" />
        <ellipse cx="218" cy="115" rx="9" ry="3.5" transform="rotate(40 218 115)" fill="#fbbf24" opacity="0.5" />
        <ellipse cx="217" cy="90" rx="9" ry="3.5" transform="rotate(35 217 90)" fill="#fbbf24" opacity="0.5" />
        <ellipse cx="215" cy="65" rx="8" ry="3" transform="rotate(30 215 65)" fill="#fbbf24" opacity="0.5" />
        <ellipse cx="212" cy="42" rx="7" ry="3" transform="rotate(20 212 42)" fill="#fbbf24" opacity="0.5" />
      </svg>
    </div>
  );
}

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
      {rank === 1 && <LaurelWreath />}
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

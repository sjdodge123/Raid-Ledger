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
    <div className="absolute -inset-4 pointer-events-none z-30" data-testid="crown-icon">
      <svg viewBox="0 0 200 200" className="w-full h-full opacity-70" fill="none">
        {/* Left branch */}
        <path d="M30 170 C30 130, 15 110, 20 80 C22 65, 30 55, 25 40 C23 30, 28 20, 35 15" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" />
        <path d="M30 150 C20 140, 12 130, 15 115" stroke="#fbbf24" strokeWidth="1.5" />
        <path d="M28 130 C18 120, 10 112, 14 97" stroke="#fbbf24" strokeWidth="1.5" />
        <path d="M25 110 C15 100, 10 90, 16 78" stroke="#fbbf24" strokeWidth="1.5" />
        <path d="M24 90 C16 82, 14 72, 20 60" stroke="#fbbf24" strokeWidth="1.5" />
        <path d="M25 70 C18 62, 18 52, 24 42" stroke="#fbbf24" strokeWidth="1.5" />
        {/* Left leaves */}
        <ellipse cx="14" cy="122" rx="8" ry="4" transform="rotate(-30 14 122)" fill="#fbbf24" opacity="0.4" />
        <ellipse cx="12" cy="102" rx="8" ry="4" transform="rotate(-25 12 102)" fill="#fbbf24" opacity="0.4" />
        <ellipse cx="14" cy="82" rx="7" ry="3.5" transform="rotate(-20 14 82)" fill="#fbbf24" opacity="0.4" />
        <ellipse cx="18" cy="62" rx="7" ry="3.5" transform="rotate(-15 18 62)" fill="#fbbf24" opacity="0.4" />
        <ellipse cx="22" cy="45" rx="6" ry="3" transform="rotate(-10 22 45)" fill="#fbbf24" opacity="0.4" />
        {/* Right branch */}
        <path d="M170 170 C170 130, 185 110, 180 80 C178 65, 170 55, 175 40 C177 30, 172 20, 165 15" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" />
        <path d="M170 150 C180 140, 188 130, 185 115" stroke="#fbbf24" strokeWidth="1.5" />
        <path d="M172 130 C182 120, 190 112, 186 97" stroke="#fbbf24" strokeWidth="1.5" />
        <path d="M175 110 C185 100, 190 90, 184 78" stroke="#fbbf24" strokeWidth="1.5" />
        <path d="M176 90 C184 82, 186 72, 180 60" stroke="#fbbf24" strokeWidth="1.5" />
        <path d="M175 70 C182 62, 182 52, 176 42" stroke="#fbbf24" strokeWidth="1.5" />
        {/* Right leaves */}
        <ellipse cx="186" cy="122" rx="8" ry="4" transform="rotate(30 186 122)" fill="#fbbf24" opacity="0.4" />
        <ellipse cx="188" cy="102" rx="8" ry="4" transform="rotate(25 188 102)" fill="#fbbf24" opacity="0.4" />
        <ellipse cx="186" cy="82" rx="7" ry="3.5" transform="rotate(20 186 82)" fill="#fbbf24" opacity="0.4" />
        <ellipse cx="182" cy="62" rx="7" ry="3.5" transform="rotate(15 182 62)" fill="#fbbf24" opacity="0.4" />
        <ellipse cx="178" cy="45" rx="6" ry="3" transform="rotate(10 178 45)" fill="#fbbf24" opacity="0.4" />
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

/**
 * Podium card for a top-3 game in the decided view (ROK-989).
 * Shows rank badge, game cover, ownership info, and price.
 */
import type { JSX } from 'react';
import type { LineupEntryResponseDto } from '@raid-ledger/contract';

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

/** Crown SVG icon for the champion card. */
function CrownIcon(): JSX.Element {
  return (
    <svg
      data-testid="crown-icon"
      className="w-5 h-5 text-yellow-400"
      fill="currentColor" viewBox="0 0 24 24"
    >
      <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5z" />
    </svg>
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

/** Ownership and price info line. */
function PodiumMeta({ entry }: { entry: LineupEntryResponseDto }): JSX.Element {
  const pct = entry.totalMembers > 0 ? Math.round((entry.ownerCount / entry.totalMembers) * 100) : 0;
  const price = entry.itadCurrentPrice != null ? `$${entry.itadCurrentPrice.toFixed(2)}` : null;

  return (
    <div className="flex items-center justify-between text-[10px] text-dim mt-1">
      <span>{entry.ownerCount} own ({pct}%)</span>
      {price && <span className="text-emerald-400">{price}</span>}
    </div>
  );
}

/** Single podium placement card with rank badge and game info. */
export function PodiumCard({ entry, rank }: PodiumCardProps): JSX.Element {
  const config = RANK_CONFIG[rank] ?? RANK_CONFIG[3];

  return (
    <div
      data-testid="podium-card"
      className={`rounded-lg border ${config.border} bg-surface overflow-hidden flex flex-col`}
    >
      <PodiumCover entry={entry} />
      <div className="px-3 py-2 flex-1 flex flex-col">
        <div className="flex items-center gap-1.5 mb-1">
          {rank === 1 && <CrownIcon />}
          <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${config.badge}`}>
            {config.label}
          </span>
        </div>
        <h4 className="text-sm font-semibold text-foreground truncate">{entry.gameName}</h4>
        <span className="text-[11px] text-muted">{entry.voteCount} votes</span>
        <PodiumMeta entry={entry} />
      </div>
    </div>
  );
}

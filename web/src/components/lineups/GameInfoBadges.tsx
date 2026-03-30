/**
 * Shared game info badges for lineup cards across all phases (ROK-989).
 * Shows ownership count, deal/price, consistent with Common Ground cards.
 */
import type { JSX } from 'react';

interface GameInfoBadgesProps {
  ownerCount: number;
  itadCurrentCut?: number | null;
  itadCurrentPrice?: number | null;
  playerCount?: { min: number; max: number } | null;
}

/** Emerald badge for library owner count. */
function OwnerBadge({ count }: { count: number }): JSX.Element {
  return (
    <span className="px-1.5 py-0.5 text-[10px] font-bold bg-emerald-500/90 text-white rounded">
      {count} own
    </span>
  );
}

/** Sale/price badge — shows discount or plain price. */
function DealBadge({ cut, price }: { cut?: number | null; price?: number | null }): JSX.Element | null {
  if (cut != null && cut > 0 && price != null) {
    return (
      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-emerald-600/90 text-white rounded">
        -{cut}% ${price.toFixed(2)}
      </span>
    );
  }
  if (price != null) {
    return (
      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-zinc-600/80 text-white rounded">
        ${price.toFixed(2)}
      </span>
    );
  }
  return null;
}

/** Purple badge for player count range. */
function PlayerBadge({ playerCount }: { playerCount?: { min: number; max: number } | null }): JSX.Element | null {
  if (!playerCount) return null;
  const { min, max } = playerCount;
  const label = min === max ? `${min}` : `${min}-${max}`;
  return (
    <span className="px-1.5 py-0.5 text-[10px] font-bold bg-violet-500/90 text-white rounded">
      {label} players
    </span>
  );
}

/** Inline badge row for ownership + player count + deal info. */
export function GameInfoBadges({ ownerCount, itadCurrentCut, itadCurrentPrice, playerCount }: GameInfoBadgesProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <OwnerBadge count={ownerCount} />
      <PlayerBadge playerCount={playerCount} />
      <DealBadge cut={itadCurrentCut} price={itadCurrentPrice} />
    </div>
  );
}

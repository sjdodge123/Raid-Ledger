/**
 * Shared game info badges for lineup cards across all phases (ROK-989).
 * Shows ownership count, deal/price, consistent with Common Ground cards.
 */
import type { JSX } from 'react';

interface GameInfoBadgesProps {
  ownerCount: number;
  itadCurrentCut?: number | null;
  itadCurrentPrice?: number | null;
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

/** Inline badge row for ownership + deal info. */
export function GameInfoBadges({ ownerCount, itadCurrentCut, itadCurrentPrice }: GameInfoBadgesProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <OwnerBadge count={ownerCount} />
      <DealBadge cut={itadCurrentCut} price={itadCurrentPrice} />
    </div>
  );
}

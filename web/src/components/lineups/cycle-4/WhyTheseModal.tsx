/**
 * "Why these suggestions?" modal (ROK-1297) — explains the Common Ground
 * scoring weights to the operator. Extracted from `CommonGroundHero.tsx`
 * to keep that file under the 300-line ESLint cap.
 */
import type { JSX } from 'react';

export interface WhyTheseModalProps {
  weights?: {
    ownerWeight: number;
    tasteWeight: number;
    socialWeight: number;
    intensityWeight: number;
    saleBonus: number;
    fullPricePenalty: number;
  };
  onClose: () => void;
}

export function WhyTheseModal({
  weights,
  onClose,
}: WhyTheseModalProps): JSX.Element {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Why these suggestions"
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface border border-edge rounded-lg max-w-md w-full mx-4 p-4 space-y-2"
      >
        <h3 className="text-sm font-semibold text-foreground">
          Why these suggestions?
        </h3>
        <p className="text-[12px] text-muted">
          Tiles are ranked by ownership in the group, your taste vector, and
          social signals (sales, wishlists).
        </p>
        {weights && (
          <ul className="text-[11px] text-muted space-y-1 list-none p-0">
            <li>Owners: {weights.ownerWeight}</li>
            <li>Taste: {weights.tasteWeight}</li>
            <li>Social: {weights.socialWeight}</li>
            <li>Intensity: {weights.intensityWeight}</li>
          </ul>
        )}
        <div className="text-right">
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] px-2 py-0.5 border border-edge rounded text-muted hover:text-foreground"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

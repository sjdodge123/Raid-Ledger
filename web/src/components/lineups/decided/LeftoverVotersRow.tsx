/**
 * "N voters didn't match" affordance for the Decided composite (ROK-1299).
 * The "Suggest more games?" button is intentionally a no-op for now — the
 * nomination re-entry flow doesn't exist yet; tracked as a follow-up.
 */
import type { JSX } from 'react';

interface LeftoverVotersRowProps {
  leftoverCount: number;
}

export function LeftoverVotersRow({
  leftoverCount,
}: LeftoverVotersRowProps): JSX.Element | null {
  if (leftoverCount <= 0) return null;
  return (
    <div
      data-testid="decided-leftover-voters-row"
      className="mt-3 text-[10px] text-muted italic"
    >
      {leftoverCount} voters didn&apos;t match &rarr;{' '}
      <button
        type="button"
        className="text-emerald-300 hover:text-emerald-200 underline italic disabled:opacity-60"
      >
        Suggest more games?
      </button>
    </div>
  );
}

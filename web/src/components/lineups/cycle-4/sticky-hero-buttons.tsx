/**
 * Three compact buttons embedded in the sticky JourneyHero of the
 * Nominating composite (ROK-1297). Extracted from NominatingComposite
 * so the parent file stays under the 300-line cap. All three share
 * visual structure (icon + label, emerald solid, 44px mobile / 36px
 * desktop tap target) so they read as a uniform action row.
 */
import type { JSX } from 'react';

export function StickyHeroSearchButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label="Search the game library"
      data-testid="sticky-hero-search"
      className="flex-1 sm:flex-initial min-h-[44px] sm:min-h-[36px] inline-flex items-center justify-center gap-2 px-3 sm:px-4 py-2 rounded-md border border-emerald-500 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-sm font-semibold text-white shadow-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <svg
        aria-hidden="true"
        className="w-4 h-4 stroke-current"
        viewBox="0 0 24 24"
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx={11} cy={11} r={7} />
        <path d="m20 20-3-3" />
      </svg>
      <span>Search</span>
    </button>
  );
}

export function StickyHeroJumpButton({
  count,
  onClick,
}: {
  count: number;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="sticky-hero-jump"
      aria-label={`Jump to your ${count} nominated games`}
      className="flex-1 sm:flex-initial min-h-[44px] sm:min-h-[36px] inline-flex items-center justify-center gap-2 px-3 sm:px-4 py-2 rounded-md border border-emerald-500 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-sm font-semibold text-white shadow-md transition-colors whitespace-nowrap"
    >
      <svg
        aria-hidden="true"
        className="w-4 h-4 stroke-current flex-shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 5v14" />
        <path d="m19 12-7 7-7-7" />
      </svg>
      <span>Nominations · {count}</span>
    </button>
  );
}

export function StickyHeroBackButton({
  onClick,
}: {
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Back to Common Ground suggestions"
      data-testid="sticky-hero-back"
      className="flex-1 sm:flex-initial min-h-[44px] sm:min-h-[36px] inline-flex items-center justify-center gap-2 px-3 sm:px-4 py-2 rounded-md border border-emerald-500 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-sm font-semibold text-white shadow-md transition-colors whitespace-nowrap"
    >
      <svg
        aria-hidden="true"
        className="w-4 h-4 stroke-current flex-shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M19 12H5" />
        <path d="m12 19-7-7 7-7" />
      </svg>
      <span>Back</span>
    </button>
  );
}

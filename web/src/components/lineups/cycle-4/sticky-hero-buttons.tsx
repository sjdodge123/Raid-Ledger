/**
 * Compact buttons embedded in the sticky JourneyHero of the Nominating
 * (ROK-1297) and Voting (ROK-1298) composites. Extracted so the parent
 * files stay under the 300-line cap. All share visual structure (icon +
 * label, emerald solid, 44px mobile / 36px desktop tap target) so they
 * read as a uniform action row.
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

/**
 * Sticky-hero submit affordance for the Voting composite (ROK-1298).
 *
 * Matches the visual chrome of StickyHeroSearchButton / JumpButton /
 * BackButton — emerald solid, 44px mobile / 36px desktop tap target.
 * Label + icon change between Submit ↔ Change my votes (state is in
 * the copy, not the color).
 *
 * `disabled` (empty kind) keeps the emerald shell but greys it out and
 * surfaces `disabledReason` to screen readers via `aria-label`.
 */
export function StickyHeroSubmitButton({
  submitted,
  used,
  max,
  disabled,
  disabledReason,
  onClick,
}: {
  submitted: boolean;
  used: number;
  max: number;
  disabled: boolean;
  disabledReason?: string;
  onClick: () => void;
}): JSX.Element {
  const label = submitted
    ? 'Change my votes'
    : `Submit my votes${used > 0 ? ` (${used}/${max})` : ''}`;
  const ariaLabel = disabled
    ? `${label} — ${disabledReason ?? 'action required first'}`
    : label;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      data-testid="sticky-hero-submit"
      className="flex-1 sm:flex-initial min-h-[44px] sm:min-h-[36px] inline-flex items-center justify-center gap-2 px-3 sm:px-4 py-2 rounded-md border border-emerald-500 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-sm font-semibold text-white shadow-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
    >
      {submitted ? (
        <svg
          aria-hidden="true"
          className="w-4 h-4 stroke-current flex-shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4 12.5-12.5z" />
        </svg>
      ) : (
        <svg
          aria-hidden="true"
          className="w-4 h-4 stroke-current flex-shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M22 2 11 13" />
          <path d="M22 2l-7 20-4-9-9-4 20-7z" />
        </svg>
      )}
      <span>{label}</span>
    </button>
  );
}

/**
 * Sticky-hero submit affordance for the Scheduling composite (ROK-1300).
 *
 * Mirrors {@link StickyHeroSubmitButton} but the label is resolved by the
 * composite (mode-aware: "Submit my times →" from-match / "Lock this time →"
 * standalone / "Change my times" post). The label doubles as the accessible
 * name. `submitted` swaps the icon (paper-plane → pencil) so the verb reads
 * in the icon too. Disabled (empty kind) keeps the emerald shell and surfaces
 * `disabledReason` to screen readers.
 */
export function StickyHeroScheduleSubmitButton({
  label,
  submitted,
  disabled,
  disabledReason,
  onClick,
}: {
  label: string;
  submitted: boolean;
  disabled: boolean;
  disabledReason?: string;
  onClick: () => void;
}): JSX.Element {
  const ariaLabel = disabled
    ? `${label} — ${disabledReason ?? 'action required first'}`
    : label;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      data-testid="sticky-hero-schedule-submit"
      className="flex-1 sm:flex-initial min-h-[44px] sm:min-h-[36px] inline-flex items-center justify-center gap-2 px-3 sm:px-4 py-2 rounded-md border border-emerald-500 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-sm font-semibold text-white shadow-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
    >
      {submitted ? (
        <svg
          aria-hidden="true"
          className="w-4 h-4 stroke-current flex-shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4 12.5-12.5z" />
        </svg>
      ) : (
        <svg
          aria-hidden="true"
          className="w-4 h-4 stroke-current flex-shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M22 2 11 13" />
          <path d="M22 2l-7 20-4-9-9-4 20-7z" />
        </svg>
      )}
      <span>{label}</span>
    </button>
  );
}

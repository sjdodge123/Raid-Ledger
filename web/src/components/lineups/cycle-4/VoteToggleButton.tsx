/**
 * Accessible vote-toggle button (ROK-1298, Sv).
 *
 * Replaces the legacy `<button data-testid="vote-toggle">` which shipped
 * without an `aria-label` (axe + manual SR audit both reported it as
 * `button "(no name)"`). The Cycle 4 canonical fix lives here.
 *
 * Contract:
 *   - `aria-label="Vote for {gameName}"` always present.
 *   - `aria-pressed` reflects {@link VoteToggleButtonProps.isVoted}.
 *   - `type="button"` so the row's enclosing form (if any) is never
 *     accidentally submitted.
 *   - The click handler stops propagation so a click on the circle does
 *     NOT bubble to the row body (whose role="button" opens the
 *     GameResearchDrawer). This is the spec's interaction matrix.
 *
 * Visual tokens mirror the wireframe at
 * `web/src/dev/simplify-wireframes/simplify-composite-mocks.tsx` —
 * filled emerald disc when voted, edge-bordered ring when unvoted.
 */
import type { JSX, KeyboardEvent, MouseEvent } from 'react';

/** Props for {@link VoteToggleButton}. */
export interface VoteToggleButtonProps {
  /** Game name; interpolated into the aria-label. */
  gameName: string;
  /** Has the current viewer voted for this entry? Drives aria-pressed. */
  isVoted: boolean;
  /** Disable the control (private non-invitee, at-limit, etc). */
  disabled: boolean;
  /** Fired on click. The component already stops event propagation. */
  onToggle: () => void;
}

/**
 * Compose the aria-label for the toggle, surfacing disabled reasons
 * to screen readers per the spec §Accessibility matrix.
 */
function ariaLabelFor(
  gameName: string,
  isVoted: boolean,
  disabled: boolean,
): string {
  if (disabled && !isVoted) return `Vote for ${gameName} (disabled)`;
  return `Vote for ${gameName}`;
}

/**
 * Explicit labeled vote button — see file-level docstring.
 *
 * ROK-1373: replaced the subtle 20px outline ring (which only turned emerald
 * AFTER voting, so the page had no green vote affordance before a vote) with a
 * solid emerald "Vote" pill / a "✓ Voted" confirmed state. Same a11y contract.
 */
export function VoteToggleButton(props: VoteToggleButtonProps): JSX.Element {
  const { gameName, isVoted, disabled, onToggle } = props;
  const cls = isVoted
    ? 'bg-emerald-600/15 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-600/25'
    : 'bg-emerald-600 hover:bg-emerald-500 text-white border border-transparent';
  const handleClick = (e: MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation();
    if (disabled) return;
    onToggle();
  };
  // Stop Enter/Space from bubbling to the row (legacy AC2/AC9 guard). Click
  // stopPropagation covers mouse activation; keydown propagation is independent.
  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
  };
  return (
    <button
      type="button"
      data-testid="vote-toggle"
      aria-label={ariaLabelFor(gameName, isVoted, disabled)}
      aria-pressed={isVoted}
      disabled={disabled}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={`flex-shrink-0 inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${cls} disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {isVoted && (
        <svg
          aria-hidden="true"
          className="w-3.5 h-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.5"
            d="M5 13l4 4L19 7"
          />
        </svg>
      )}
      {isVoted ? 'Voted' : 'Vote'}
    </button>
  );
}

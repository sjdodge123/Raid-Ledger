/**
 * Top-pick ("star") toggle — ROK-1474, the starred ballot.
 *
 * Sits beside {@link VoteToggleButton} inside the existing voting row
 * (operator ruling, 2026-09-05 Q7: a star icon beside each approval control,
 * inside the row, no new surface). Starring implies approval — the server
 * writes `rank = 1` onto the voter's approval row, inserting one if needed —
 * so this control is enabled even for an unvoted entry.
 *
 * **Stars are private until the outcome** (operator ruling, Q4). This
 * component therefore takes no count prop and renders no tally: the only star
 * information an open ballot discloses is the viewer's own pick, carried by
 * `isStarred` / `aria-pressed`.
 *
 * A11y contract, mirrored from `VoteToggleButton.tsx:55`:
 *   - `aria-label="Mark {gameName} as your top pick"` (+ ` (disabled)`).
 *   - `aria-pressed` reflects {@link StarToggleButtonProps.isStarred}.
 *   - click/keydown `stopPropagation()` so the row's drawer never opens.
 */
import type { JSX, KeyboardEvent, MouseEvent } from 'react';

/** Props for {@link StarToggleButton}. */
export interface StarToggleButtonProps {
    /** Game name; interpolated into the aria-label. */
    gameName: string;
    /** Is this entry the viewer's own top pick? Drives aria-pressed. */
    isStarred: boolean;
    /** Disable the control (hold open, private non-invitee, etc). */
    disabled: boolean;
    /** Fired on activation. The component already stops propagation. */
    onToggle: () => void;
}

/** Accessible name; the disabled suffix mirrors the vote toggle's. */
function starLabel(gameName: string, disabled: boolean): string {
    const base = `Mark ${gameName} as your top pick`;
    return disabled ? `${base} (disabled)` : base;
}

/** The star glyph. Solid when it is the viewer's pick, outline otherwise. */
function StarGlyph({ filled }: { filled: boolean }): JSX.Element {
    return (
        <svg
            aria-hidden="true"
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill={filled ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="2"
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"
            />
        </svg>
    );
}

/** Top-pick toggle — see file-level docstring. */
export function StarToggleButton(props: StarToggleButtonProps): JSX.Element {
    const { gameName, isStarred, disabled, onToggle } = props;
    const cls = isStarred
        ? 'text-amber-400 border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/20'
        : 'text-muted border-edge hover:text-amber-300 hover:border-amber-500/40';
    const handleClick = (e: MouseEvent<HTMLButtonElement>): void => {
        e.stopPropagation();
        if (disabled) return;
        onToggle();
    };
    // Keyboard activation propagates independently of click — stop it too, or
    // Enter/Space on the star bubbles to the row body (legacy AC9 guard).
    const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
        if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
    };
    return (
        <button
            type="button"
            data-testid="star-toggle"
            aria-label={starLabel(gameName, disabled)}
            aria-pressed={isStarred}
            disabled={disabled}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            title="Your top pick — breaks a tie"
            className={`flex-shrink-0 inline-flex items-center justify-center rounded-md border p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${cls} disabled:opacity-40 disabled:cursor-not-allowed`}
        >
            <StarGlyph filled={isStarred} />
        </button>
    );
}

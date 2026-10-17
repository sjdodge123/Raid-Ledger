/**
 * Shared class strings for the form primitives (ROK-1646, spike ROK-1644 §4.0).
 * One file so Button, Input, Select, Textarea and SearchInput cannot drift.
 * Tokens only — see docs/design-system.md §2.1.
 */

/**
 * Keyboard focus ring on the `success` token (operator ruling, ROK-1646).
 *
 * The alpha is /80, not the spike's /50: WCAG 1.4.11 wants >= 3:1 for the ring
 * against the surface it sits on, and measured against `bg-panel`
 * /50 is 2.48:1 (dark) and 2.09:1 (light), /70 fails light at 2.93:1, while
 * /80 clears both — 4.20:1 dark, 3.51:1 light (3.75:1 on `bg-surface`).
 */
export const FOCUS_RING =
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success/80';

/** The one disabled treatment (retires bg-*-800, opacity-30/40, bg-overlay text-dim). */
export const DISABLED = 'disabled:opacity-50 disabled:cursor-not-allowed';

/**
 * Field frame WITHOUT padding. Padding lives in {@link FIELD_PAD} so a size
 * swaps it instead of fighting it. `text-base` below `lg` stops iOS Safari
 * zooming on focus (design-system.md §4.18: the phone/desktop split is `lg`).
 */
export const FIELD_FRAME_BASE = [
    'w-full min-h-[44px] bg-panel border border-edge rounded-lg',
    'text-base lg:text-sm text-foreground placeholder:text-dim',
    `focus:outline-none ${FOCUS_RING} ${DISABLED}`,
    'aria-[invalid=true]:border-danger',
].join(' ');

export type FieldSize = 'md' | 'lg' | 'sm';

/** Padding per field size. `sm` is compact on desktop only — it stays 44px below `lg`. */
export const FIELD_PAD: Record<FieldSize, string> = {
    md: 'px-3 py-2',
    lg: 'px-4 py-3',
    sm: 'px-3 py-2 lg:min-h-9 lg:px-2 lg:py-1',
};

/** The md field frame, as the spike names it — for controls without sizes. */
export const FIELD_FRAME = `${FIELD_FRAME_BASE} ${FIELD_PAD.md}`;

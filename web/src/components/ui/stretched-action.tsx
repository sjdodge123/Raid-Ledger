/**
 * StretchedAction — the whole-card action of a clickable card that holds its
 * own controls (docs/design-system.md §4.2, TDB:1949).
 *
 * A native `<button type="button">` with no visible content and no fill,
 * stretched over its `relative` frame. `-inset-px` (not `inset-0`) reaches over
 * the frame's 1px border too, so a click on the border fires the action instead
 * of landing on a dead strip under a pointer cursor; `rounded-lg` then matches
 * the frame's outer corner. The focus ring is the shared `FOCUS_RING` on the
 * button idiom's `ring-offset-2 ring-offset-surface`: with `-inset-px` a flush
 * ring would sit exactly on a frame's own `ring-2` (RosterSlot's current-user
 * glow) and all but vanish, so it stands 2px off the frame instead.
 * `label` is the only accessible name: `aria-label` / `aria-labelledby` are left
 * out of the props, and because TS does not excess-check hyphenated JSX
 * attributes, the fixed attributes are also written after the spread so a
 * passed one can never win.
 *
 * Render it as the frame's FIRST child. The card's own link / button / titled
 * badge get `relative` and come later in DOM order, so they paint and take
 * clicks above it — no z-index, and never a `role="button"` wrapper around them
 * (axe `nested-interactive`). It is not `Button`: that one is `relative
 * inline-flex` with a 44px minimum, padding and a label span, all of which
 * fight an invisible overlay (and `Button` has no tailwind-merge).
 */
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { FOCUS_RING } from './form-classes';

export const STRETCHED_ACTION_CLASS =
    `absolute -inset-px cursor-pointer rounded-lg ${FOCUS_RING} focus-visible:ring-offset-2 focus-visible:ring-offset-surface`;

export interface StretchedActionProps
    extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'aria-labelledby' | 'children' | 'className' | 'type'> {
    /** Accessible name. The button shows nothing, so keep any visible verb ("Join", "Assign") in it (WCAG 2.5.3). */
    label: string;
}

/** The card-wide action button. See the file header for the contract. */
export const StretchedAction = forwardRef<HTMLButtonElement, StretchedActionProps>(function StretchedAction(
    { label, ...rest }, ref,
) {
    return (
        <button {...rest} ref={ref} type="button" aria-label={label} aria-labelledby={undefined} className={STRETCHED_ACTION_CLASS} />
    );
});

/**
 * CharCounter — the `n/max` readout shared by `Textarea` and the Markdown
 * editor (ROK-1868; extracted from ROK-1646's `Textarea`).
 *
 * - The visible `n/max` (`text-xs text-dim`) is always shown and NOT live —
 *   join its `id` to the control's `aria-describedby`.
 * - A separate `sr-only` polite region says "N characters left" only in the
 *   last 10% of `max` (at most 20), and "N characters over the limit" past it.
 * - Over `max`, or `invalid`, the readout takes the danger token.
 * - Returns a fragment; the caller owns the wrapper.
 */
import type { JSX } from 'react';

export interface CharCounterProps {
    /** id of the visible readout — put it in the control's `aria-describedby`. */
    id: string;
    /** Current length (the source length for Markdown). */
    length: number;
    max: number;
    /** Force the danger token (it is automatic over `max`). */
    invalid?: boolean;
    /** Test id of the readout; the live region gets `${testId}-live`. Default `char-count`. */
    testId?: string;
}

/** What the polite region says: near the limit, over it, or nothing. */
function liveText(length: number, max: number): string {
    const left = max - length;
    if (left < 0) return `${-left} characters over the limit`;
    return left <= Math.min(20, Math.ceil(max * 0.1)) ? `${left} characters left` : '';
}

/** The shared character counter. See the file header for the contract. */
export function CharCounter({ id, length, max, invalid, testId = 'char-count' }: CharCounterProps): JSX.Element {
    const tone = invalid === true || length > max ? 'text-danger' : 'text-dim';
    return (
        <>
            <p id={id} data-testid={testId} className={`mt-1 text-right text-xs ${tone}`}>
                {length}/{max}
            </p>
            <span data-testid={`${testId}-live`} aria-live="polite" className="sr-only">{liveText(length, max)}</span>
        </>
    );
}

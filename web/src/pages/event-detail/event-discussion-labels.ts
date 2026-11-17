/**
 * ROK-2226 L4b — text for the `?discussion=1` panel header. Kept out of
 * `EventDiscussionPanel.tsx` so that file exports components only
 * (react-refresh/only-export-components).
 */
import type { EventResponseDto } from '@raid-ledger/contract';
import { resolveEventCapacity } from '../../lib/event-capacity';

/**
 * "18 / 40 signed up", or "18 signed up" without a cap (mockup thread header).
 * The cap is the allocation capacity (slot roster first, ROK-2229), the same
 * "/ M" the hub thread header shows; a 0 cap reads "N / 0".
 */
export function signedUpLabel(
    event: Pick<
        EventResponseDto,
        'signupCount' | 'maxAttendees' | 'slotConfig'
    >,
): string {
    const cap = resolveEventCapacity(event);
    return cap === null
        ? `${event.signupCount} signed up`
        : `${event.signupCount} / ${cap} signed up`;
}

/**
 * ROK-2226 L4b — text for the `?discussion=1` panel header. Kept out of
 * `EventDiscussionPanel.tsx` so that file exports components only
 * (react-refresh/only-export-components).
 */
import type { EventResponseDto } from '@raid-ledger/contract';

/** "18 / 40 signed up", or "18 signed up" without a cap (mockup thread header). */
export function signedUpLabel(
    event: Pick<EventResponseDto, 'signupCount' | 'maxAttendees'>,
): string {
    const cap = event.maxAttendees ?? null;
    return cap === null
        ? `${event.signupCount} signed up`
        : `${event.signupCount} / ${cap} signed up`;
}

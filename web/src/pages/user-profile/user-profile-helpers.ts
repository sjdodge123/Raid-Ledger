import type { GuestRouteState } from '../../lib/guest-profile-link';

/** Route state for a guest (PUG) user profile (ROK-381) — built by `guestProfileLink`. */
export type { GuestRouteState };

/** Type guard for guest route state */
export function isGuestRouteState(state: unknown): state is GuestRouteState {
    return (
        state != null &&
        typeof state === 'object' &&
        (state as Record<string, unknown>).guest === true &&
        typeof (state as Record<string, unknown>).username === 'string'
    );
}

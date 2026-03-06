/** Route state passed when navigating to a guest (PUG) user profile (ROK-381). */
export interface GuestRouteState {
    guest: true;
    username: string;
    discordId: string;
    avatarHash: string | null;
}

/** Type guard for guest route state */
export function isGuestRouteState(state: unknown): state is GuestRouteState {
    return (
        state != null &&
        typeof state === 'object' &&
        (state as Record<string, unknown>).guest === true &&
        typeof (state as Record<string, unknown>).username === 'string'
    );
}

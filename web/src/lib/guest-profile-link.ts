/**
 * ROK-381 guest profile link for a Discord user with no Raid Ledger account.
 * There is no member row behind them (the API sends user id 0), so the path is
 * `/users/0` and the profile page renders the guest view from this router state
 * (`isGuestRouteState`). Roster slot cards and roster list rows both build their
 * link here, so the two surfaces behave identically (ROK-1694).
 */
export const GUEST_PROFILE_PATH = '/users/0';

/** Route state passed when navigating to a guest (PUG) user profile (ROK-381). */
export interface GuestRouteState {
    guest: true;
    username: string;
    discordId: string;
    avatarHash: string | null;
}

export interface GuestProfileInput {
    username: string;
    discordId?: string | null;
    avatarHash?: string | null;
}

/** `to` + `state` for a react-router `<Link>` to the guest profile. */
export function guestProfileLink({ username, discordId, avatarHash }: GuestProfileInput): {
    to: string;
    state: GuestRouteState;
} {
    return {
        to: GUEST_PROFILE_PATH,
        state: { guest: true, username, discordId: discordId ?? '', avatarHash: avatarHash ?? null },
    };
}

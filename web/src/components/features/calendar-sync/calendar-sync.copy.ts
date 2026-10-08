/**
 * Every user-facing string on the Profile → Calendars page (ROK-1594).
 *
 * Copy is the approved design (K1/K2/K4) verbatim. K1's lede and "Only busy
 * times" note describe READ sync, which ships later (plan Q-B). The Lead kept
 * the approved copy for now; swapping to the interim write-first lede is the
 * one-line change in `CALENDARS_COPY.lede` below.
 */

/** Approved K1 lede (describes read sync). */
const LEDE_APPROVED = 'Connect a calendar and Raid Ledger fills in your time away for you.';
/** Interim write-first lede, held for the Q-B ruling. */
export const LEDE_WRITE_FIRST = 'Connect a calendar and Raid Ledger adds your sign-ups to a Google calendar.';

export const CALENDARS_COPY = {
    title: 'Calendars',
    lede: LEDE_APPROVED,
    noteTitle: 'Only busy times.',
    noteBody: 'Raid Ledger never sees event titles, places or who is invited, only when you are busy. Disconnect any time and the synced days disappear.',
    connectedHeading: 'Connected',
    addHeading: 'Add a calendar',
    unavailable: 'Calendar sync is turned off for this community.',
    loadError: 'Could not load your calendars. Refresh to try again.',
    google: {
        name: 'Google Calendar',
        tile: 'G',
        hint: 'Sign in with Google',
        notConfigured: 'Not set up on this server yet. Ask an admin.',
        connect: 'Connect',
        connecting: 'Connecting…',
        startFailed: 'Could not start the Google sign-in. Try again.',
    },
    toastConnected: 'Google Calendar connected',
    toastDisconnected: 'Google Calendar disconnected',
    manage: 'Manage',
    manageTitle: 'Manage calendar',
    disconnect: 'Disconnect',
    disconnecting: 'Disconnecting…',
    confirmTitle: 'Disconnect Google Calendar?',
    confirmBody: 'Raid Ledger stops syncing with this account. You can connect it again any time.',
    confirmCancel: 'Cancel',
    disconnectFailed: 'Could not disconnect. Try again.',
    dismiss: 'Dismiss',
} as const;

/** The status line under a connection's name ("Connected · <email>"). */
export const CONNECTION_STATUS_COPY = {
    active: 'Connected',
    needs_reconnect: 'Needs reconnecting',
    error: 'Sync error',
    disconnecting: 'Disconnecting…',
} as const;

/** "Connected · a@b.c", or just the status when the account has no label. */
export function connectionStatusLine(c: { status: keyof typeof CONNECTION_STATUS_COPY; accountLabel: string | null }): string {
    const status = CONNECTION_STATUS_COPY[c.status];
    return c.accountLabel ? `${status} · ${c.accountLabel}` : status;
}

/**
 * `?error=<code>` from the OAuth callback redirect.
 * TODO(ROK-1592 2d): use CalendarOAuthErrorCodeSchema
 */
export type CalendarOAuthErrorCode = 'state' | 'denied' | 'exchange' | 'scopes' | 'disabled' | 'unavailable';

export const OAUTH_ERROR_COPY: Record<CalendarOAuthErrorCode, string> = {
    state: 'That sign-in link expired or was already used. Connect again to retry.',
    denied: 'Google sign-in was cancelled, so nothing was connected.',
    exchange: 'Google did not finish the sign-in. Connect again to retry.',
    scopes: 'Raid Ledger needs permission to manage its own calendar. Connect again and leave that box ticked.',
    disabled: 'Calendar sync is turned off for this community.',
    unavailable: 'Google Calendar is not set up on this server yet. Ask an admin.',
};

/** Copy for a code this build does not know. */
export const OAUTH_ERROR_FALLBACK = 'Something went wrong connecting your calendar. Try again.';

/** Banner copy for any `?error=` value, known or not. */
export function oauthErrorMessage(code: string): string {
    return Object.prototype.hasOwnProperty.call(OAUTH_ERROR_COPY, code)
        ? OAUTH_ERROR_COPY[code as CalendarOAuthErrorCode]
        : OAUTH_ERROR_FALLBACK;
}

/**
 * Every user-facing string on the Profile → Calendars page (ROK-1594).
 *
 * Copy is the approved design (K1/K2/K4) verbatim. K1's lede and "Only busy
 * times" note describe READ sync, which ships later (plan Q-B). The Lead kept
 * the approved copy for now; swapping to the interim write-first lede is the
 * one-line change in `CALENDARS_COPY.lede` below.
 */

import type { CalendarConnection, CalendarOAuthErrorCode } from '@raid-ledger/contract';

/** Approved K1 lede (describes read sync). */
const LEDE_APPROVED = 'Connect a calendar and Raid Ledger fills in your time away for you.';
/** Interim write-first lede, held for the Q-B ruling. */
export const LEDE_WRITE_FIRST = 'Connect a calendar and Raid Ledger adds your sign-ups to a Google calendar.';

export const CALENDARS_COPY = {
    title: 'Calendars',
    lede: LEDE_APPROVED,
    /** K4 desktop lede (ROK-1595), verbatim. */
    ledeDesktop: 'Connect a calendar and Raid Ledger keeps your time away up to date. Only busy times are read.',
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
        hintAnother: 'Connect another Google account',
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

/** `?error=<code>` from the OAuth callback redirect (contract enum). */
export type { CalendarOAuthErrorCode };

export const OAUTH_ERROR_COPY: Record<CalendarOAuthErrorCode, string> = {
    state: 'That sign-in link expired or was already used. Connect again to retry.',
    denied: 'Google sign-in was cancelled, so nothing was connected.',
    exchange: 'Google did not finish the sign-in. Connect again to retry.',
    scopes: 'Raid Ledger needs permission to manage its own calendar. Connect again and leave that box ticked.',
    disabled: 'Calendar sync is turned off for this community.',
    unavailable: 'Google Calendar is not set up on this server yet. Ask an admin.',
    // ROK-1593 contract code; ROK-1595 owns the final read-consent copy.
    read_scopes: 'Raid Ledger needs permission to see when you are busy. Allow access again and leave those boxes ticked.',
};

/** Copy for a code this build does not know. */
export const OAUTH_ERROR_FALLBACK = 'Something went wrong connecting your calendar. Try again.';

/** Banner copy for any `?error=` value, known or not. */
export function oauthErrorMessage(code: string): string {
    return Object.prototype.hasOwnProperty.call(OAUTH_ERROR_COPY, code)
        ? OAUTH_ERROR_COPY[code as CalendarOAuthErrorCode]
        : OAUTH_ERROR_FALLBACK;
}

/** "Send my events" — K4 desktop / K5 phone, verbatim (ROK-1596 W1). No tentative toggle: tentative always syncs. */
export const SEND_EVENTS_COPY = {
    heading: 'Send my Raid Ledger events',
    tag: 'two-way',
    switchLabel: 'Add events I sign up for',
    putThemIn: 'Put them in',
    dedicated: 'A "Raid Ledger" calendar',
    primary: 'My main calendar',
    phone: { helper: 'New sign-ups show up within a minute', dedicated: 'We create it and only ever touch that one. Hide or delete it any time.', primary: 'Events sit with everything else.' },
    desktop: { helper: 'To Google Calendar', dedicated: 'We only ever touch that one', primary: 'Next to everything else' },
    noteTitle: 'Stays in step.',
    noteBody: "A new time moves the event, a cancellation or leaving the roster removes it. We never read these copies back as busy time, so your own sign-up can't clash with itself.",
    /* Not on the canvas (lane copy, F6 / errors). */
    alreadyEnabled: 'Another connected calendar already gets your events. Turn it off there first.',
    saveFailed: 'Could not save. Try again.',
    consentFailed: 'Could not start the Google sign-in. Try again.',
    /* K5 as its own phone page (W1b), reached from K2's row. */
    /* K2 section label over the phone entry row. */
    writeHeading: 'Write · send my Raid Ledger events',
    pageTitle: 'Send my events',
    back: 'Calendars',
    entrySub: { dedicated: 'To Google Calendar · a "Raid Ledger" calendar', primary: 'To Google Calendar · my main calendar', off: 'Off' },
    notFound: 'That calendar is no longer connected.',
} as const;

/** Provider display names for the event line + toast ("On your Google Calendar"). */
export const PROVIDER_CALENDAR_NAME = { google: 'Google Calendar', microsoft: 'Outlook Calendar', apple: 'Apple Calendar' } as const;

/** S3 — the event page's calendar line, the sign-up toast and the "Add to calendar" menu (ROK-1596 W2). */
export const EVENT_CALENDAR_COPY = {
    /* Canvas S3, verbatim. */
    on: (calendar: string) => `On your ${calendar}`,
    open: 'Open',
    toastSignedUp: 'Signed up.',
    toastAdded: (calendar: string) => `Added to ${calendar}`,
    undo: 'Undo',
    addToCalendar: 'Add to calendar',
    /* Not on the canvas (lane copy): menu labels, pending / failed states, errors. */
    menuGoogle: 'Google Calendar',
    menuOutlook: 'Outlook',
    menuIcs: 'Download .ics',
    pending: (calendar: string) => `Adding to your ${calendar}…`,
    failed: (calendar: string) => `Couldn't add this to your ${calendar}`,
    undoFailed: 'Could not remove the calendar copy. Try again.',
    icsFailed: 'Could not download the calendar file. Try again.',
} as const;

/** "N min ago" for a sync timestamp (lane copy beyond the canvas's "4 min ago"). */
export function syncedAgo(iso: string, now: number = Date.now()): string {
    const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.floor(hours / 24);
    return days === 1 ? '1 day ago' : `${days} days ago`;
}

/**
 * Read sync (ROK-1595): K2 phone switches, K4 desktop radio cards, the
 * calendar picker, the connection status and "Sync now". Canvas copy is
 * verbatim; lines marked (lane) are not on the canvas.
 */
export const READ_COPY = {
    phoneHeading: 'Read · when a calendar says you are busy',
    desktopHeading: 'When a calendar says you are busy',
    days: { title: 'Whole days → I\'m away', sub: 'All-day events, and days busy through all your game time', aria: 'Whole days become away' },
    hours: { title: 'Busy hours → busy', sub: 'Shown in purple; polls stop counting you as free', aria: 'Busy hours become busy' },
    lookAhead: 'Look ahead',
    lookAheadSub: 'How far forward we check',
    lookAheadTag: (weeks: number) => `${weeks} weeks`,
    modes: {
        days: { label: 'Whole days only', description: 'All-day events and fully booked evenings become "I\'m away". Busy hours are ignored.' },
        hours: { label: 'Busy hours only', description: 'Every busy hour inside your game time turns purple. No away days are added.' },
        both: { label: 'Both (default)', description: 'Whole days become away; single busy hours turn purple.' },
    },
    synced: (ago: string) => `Synced ${ago}`,
    syncedCount: (ago: string, count: number) => `Synced ${ago} · ${count} ${count === 1 ? 'calendar' : 'calendars'}`,
    /* (lane) from here on. */
    reconnect: 'Access was revoked · reconnect',
    fix: 'Fix',
    fixFailed: 'Could not start the Google sign-in. Try again.',
    grantTitle: 'Let Raid Ledger see when you are busy',
    grant: 'Grant read access',
    granting: 'Opening Google…',
    saveFailed: 'Could not save. Try again.',
    pickerLabel: 'Calendars to check',
    pickerLoading: 'Loading calendars…',
    pickerError: 'Could not load your calendars. Try again.',
    pickerEmpty: 'No calendars found in this account.',
    syncNow: 'Sync now',
    syncing: 'Syncing your calendar…',
    throttled: 'Synced a moment ago. Try again in a few minutes.',
    syncNeedsRead: 'Turn on reading for this calendar first.',
    syncFailed: 'Could not sync. Try again.',
} as const;

/** The status line under the account name; `desktop` drops the calendar count (K4). */
type StatusInput = Pick<CalendarConnection, 'status' | 'accountLabel' | 'lastSyncedAt' | 'read'>;

export function readStatusLine(c: StatusInput, desktop: boolean, now: number = Date.now()): string {
    if (c.status === 'needs_reconnect') return READ_COPY.reconnect;
    if (c.status !== 'active' || !c.lastSyncedAt) return connectionStatusLine(c);
    const ago = syncedAgo(c.lastSyncedAt, now);
    if (desktop || !c.read.enabled) return READ_COPY.synced(ago);
    return READ_COPY.syncedCount(ago, c.read.calendarIds.length || 1);
}

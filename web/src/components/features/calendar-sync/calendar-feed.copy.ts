/**
 * Subscribe link (ROK-1599, design K6) copy. Its own file because
 * `calendar-sync.copy.ts` is near the 300-line cap. No tentative switch:
 * tentative sign-ups are always in the feed (operator ruling, OPERATOR-2).
 */
export const FEED_COPY = {
    heading: 'Subscribe link',
    intro: "Using a calendar app we can't connect to? Subscribe to your Raid Ledger events instead. Works in any calendar app.",
    getLink: 'Get link',
    gettingLink: 'Getting link…',
    linkLabel: 'Your events link',
    open: 'Open in calendar app',
    copy: 'Copy link',
    copied: 'Link copied',
    note: 'Updates are slower here. Most apps refresh a subscription every hour or so; some take up to a day. The link is private to you.',
    reset: 'Reset link',
    createFailed: 'Could not get a link. Try again.',
    confirmTitle: 'Reset your subscribe link?',
    confirmBody: 'The old link stops working at once; re-subscribe in your calendar app with the new one.',
    confirmCancel: 'Cancel',
    confirmReset: 'Reset link',
    resetting: 'Resetting…',
    resetFailed: 'Could not reset the link. Try again.',
} as const;

/** `webcal:` makes the OS hand the feed to the default calendar app. */
export function webcalUrl(url: string): string {
    return url.replace(/^https?:/, 'webcal:');
}

/**
 * Every user-facing string of the Apple iCloud connect flow (ROK-1598 K1 row +
 * K3 sheet). Kept apart from `calendar-sync.copy.ts`, which is near its cap.
 */
import type { AppleConnectFailure } from '../../../hooks/use-calendar-sync';

/** Apple's "app-specific passwords" support article (verified 2026-10-20: title "Sign in to apps with your Apple Account using app-specific passwords"). */
export const APPLE_APP_PASSWORD_HELP_URL = 'https://support.apple.com/en-us/102654';

export const APPLE_CONNECT_COPY = {
    name: 'Apple iCloud',
    tile: 'iC',
    hint: 'Uses an app-specific password',
    hintAnother: 'Connect another Apple ID',
    unavailable: 'Not available on this server yet. Ask an admin.',
    connect: 'Connect',
    connecting: 'Connecting…',
    cancel: 'Cancel',
    titleConnect: 'Connect Apple Calendar',
    titleReconnect: 'Reconnect Apple Calendar',
    intro: 'Apple calendars connect with an app-specific password, not your Apple ID password.',
    twoFactor: 'App-specific passwords need two-factor authentication turned on for your Apple ID.',
    steps: [
        'Go to account.apple.com → Sign-In and Security → App-Specific Passwords.',
        'Create one named Raid Ledger.',
        'Paste it here.',
    ],
    helpLink: 'How app-specific passwords work',
    emailLabel: 'Apple ID email',
    passwordLabel: 'App-specific password',
    passwordPlaceholder: 'xxxx-xxxx-xxxx-xxxx',
    emailInvalid: 'Enter the email address of your Apple ID.',
    passwordInvalid: 'App-specific passwords look like xxxx-xxxx-xxxx-xxxx.',
    privacy: 'Raid Ledger stores this password encrypted and only uses it to read busy times and add your sign-ups. Revoke it any time at account.apple.com.',
    discardMessage: 'The email and password you typed will be cleared.',
    toastConnected: 'Apple Calendar connected',
} as const;

/** Inline error per refused connect. */
export const APPLE_CONNECT_ERROR_COPY: Record<AppleConnectFailure, string> = {
    invalid_input: 'Check the email and the app-specific password format, then try again.',
    apple_auth_failed: "Apple didn't accept that email and app-specific password. Check both, or create a new password.",
    apple_unavailable: "iCloud didn't respond. Try again in a minute.",
    network: "iCloud didn't respond. Try again in a minute.",
    throttled: 'Too many tries. Wait a few minutes.',
};

/**
 * ROK-2151 — the staff "Claim your character" banner's copy and its
 * per-session dismiss memory (D6). Pure helpers so the rule is unit-tested
 * apart from the UI. sessionStorage on purpose: the × hides the banner for the
 * rest of the browser session, not forever (Valheim's banner uses localStorage).
 */

export const CLAIM_BANNER_COPY = {
    /** The landmark's accessible name (`<section aria-label>`). */
    label: 'Claim your character',
    line: "You're not a member of this guild yet — Claim your character to join.",
    button: 'Claim your character',
    dismiss: 'Dismiss',
} as const;

/** The sessionStorage key for one guild's dismiss. */
export function claimBannerDismissKey(guildId: number): string {
    return `rl:wow-claim-banner-dismissed:${guildId}`;
}

/**
 * Dismisses whose sessionStorage write was refused (private mode / quota). Kept
 * for this page session so the × still hides the banner until a reload.
 */
const unsavedDismisses = new Set<number>();

/** Whether this browser session dismissed the banner for this guild. */
export function readClaimBannerDismissed(guildId: number): boolean {
    if (unsavedDismisses.has(guildId)) return true;
    try {
        return sessionStorage.getItem(claimBannerDismissKey(guildId)) === '1';
    } catch {
        return false;
    }
}

/** Remember a dismiss for this browser session; a refused write is kept in memory instead. */
export function writeClaimBannerDismissed(guildId: number): void {
    try {
        sessionStorage.setItem(claimBannerDismissKey(guildId), '1');
    } catch {
        unsavedDismisses.add(guildId);
    }
}

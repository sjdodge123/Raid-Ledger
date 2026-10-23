/**
 * ROK-1933 Part 1 — the claim banner's copy, visibility rule and the Overview
 * dismiss memory. Pure helpers so the rule is unit-tested apart from the UI.
 */
import type { ValheimCharacterSummary } from '@raid-ledger/contract';

/**
 * Every banner string in one place. PENDING operator approval (ITEM.md Q1,
 * recommendation A) — reword here only.
 */
export const CLAIM_BANNER_COPY = {
    linkHeading: (server: string): string => `Playing on ${server}?`,
    linkBody:
        'Link Steam and every character you play here is claimed for you. Or pick yours from the list.',
    pickHeading: (server: string): string =>
        `Can't find your character on ${server}?`,
    pickBody:
        'None of the characters here belong to your linked Steam account yet. If you play on another Steam account, pick yours from the list.',
    linkSteam: 'Link Steam',
    pick: 'Pick my character',
    dismiss: 'Dismiss',
    fallbackServer: 'this server',
    unclaimedFilter: 'Unclaimed only',
} as const;

/** `link-steam` = variant (a); `pick-only` = variant (b), Steam already linked (D3). */
export type ClaimBannerVariant = 'link-steam' | 'pick-only';

/** Search param that filters the Characters tab to unclaimed rows (D4). */
export const CLAIM_FILTER_PARAM = 'unclaimed';

export interface ClaimBannerInput {
    rows: readonly ValheimCharacterSummary[];
    /** Every character on the server is loaded (no further page). */
    complete: boolean;
    viewerId: number | null;
    steamLinked: boolean;
}

/**
 * Which banner the viewer sees, or null for none. Shown only to a signed-in
 * viewer with no claim on this server while ≥1 character is unclaimed. A
 * partial list (D1: the list is paginated) can prove a claim but never its
 * absence, so it hides — the banner never nags someone who already claimed.
 */
export function claimBannerVariant(
    input: ClaimBannerInput,
): ClaimBannerVariant | null {
    const { rows, complete, viewerId, steamLinked } = input;
    if (viewerId === null) return null;
    if (rows.some((r) => r.claimedBy?.id === viewerId)) return null;
    if (!complete) return null;
    if (!rows.some((r) => r.claimedBy === null)) return null;
    return steamLinked ? 'pick-only' : 'link-steam';
}

const dismissKey = (serverId: number): string =>
    `rl:valheim-claim-banner-dismissed:${serverId}`;

/** Whether this browser dismissed the Overview banner for this server. */
export function readClaimBannerDismissed(serverId: number): boolean {
    try {
        return localStorage.getItem(dismissKey(serverId)) === '1';
    } catch {
        return false;
    }
}

/** Remember an Overview dismiss in this browser (storage refusal is ignored). */
export function writeClaimBannerDismissed(serverId: number): void {
    try {
        localStorage.setItem(dismissKey(serverId), '1');
    } catch {
        // Private mode / quota: the dismiss lasts for this render only.
    }
}

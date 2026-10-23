/**
 * ROK-1933 Part 1 — the claim banner's copy, visibility rule and the Overview
 * dismiss memory. Pure helpers so the rule is unit-tested apart from the UI.
 */
import type { ValheimClaimStatusResponse } from '@raid-ledger/contract';

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

/** `search` with the unclaimed filter set or cleared; every other param kept (`?post=`). */
export function withUnclaimedParam(search: string, on: boolean): string {
    const next = new URLSearchParams(search);
    if (on) next.set(CLAIM_FILTER_PARAM, '1');
    else next.delete(CLAIM_FILTER_PARAM);
    return next.size ? `?${next.toString()}` : '';
}

export interface ClaimBannerInput {
    /** The server's claim facts (`…/claim-status`); null while unknown. */
    status: ValheimClaimStatusResponse | null;
    viewerId: number | null;
    steamLinked: boolean;
}

/**
 * Which banner the viewer sees, or null for none. Shown only to a signed-in
 * viewer with no claim on this server while ≥1 character is unclaimed. The
 * facts come from the server (D1: the list is paginated, so loaded rows can
 * never prove a claim's absence); unknown hides — never a wrong nag.
 */
export function claimBannerVariant(
    input: ClaimBannerInput,
): ClaimBannerVariant | null {
    const { status, viewerId, steamLinked } = input;
    if (viewerId === null || status === null) return null;
    if (status.viewerHasClaim || status.unclaimedCount === 0) return null;
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

/**
 * ROK-2153 S4 — Valheim on the core "claim your character" prompt. The api
 * provider (`valheim-hub-claim.provider.ts`) serves the candidates and the
 * one-click suggested match; this is the web half: Valheim's heading (ROK-1933
 * `CLAIM_BANNER_COPY`) and the Valheim caches a claim refreshes. The body (and
 * the phone body) stay the core default: the prompt has no Link Steam action,
 * so Valheim's "Link Steam and ..." banner copy would ask for something it
 * cannot do. That copy stays on the Characters-tab banner, which has the button.
 * Replaces the retired Overview `claim-banner` widget (spec resolution 1).
 */
import type { QueryClient } from '@tanstack/react-query';
import type { HubClaimResult } from '@raid-ledger/contract';
import type { HubClaimProvider } from '../../../components/hub/claim/hub-claim-providers';
import { invalidateOwnership } from '../hooks/use-valheim-claims';
import { CLAIM_BANNER_COPY as COPY } from './valheim-claim-banner.helpers';

/**
 * The same caches the armory's own claim refreshes (`invalidateOwnership`): the
 * sheet, every list page, the claim history, the claim status, materials and the
 * planner. The candidate id is the armory profile id as a decimal string.
 */
export async function invalidateAfterHubClaim(result: HubClaimResult, qc: QueryClient): Promise<void> {
    const id = Number(result.claimed.id);
    if (!Number.isSafeInteger(id) || id <= 0) return;
    await invalidateOwnership(qc, id);
}

export const valheimHubClaimProvider: HubClaimProvider = {
    games: ['valheim'],
    kinds: ['game_server'],
    copy: {
        heading: COPY.linkHeading(COPY.fallbackServer),
        cta: COPY.pick,
    },
    onClaimed: invalidateAfterHubClaim,
};

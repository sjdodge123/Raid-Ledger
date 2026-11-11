/**
 * ROK-2153 S6-BG3 — Baldur's Gate 3 on the core "claim your character" prompt.
 * The api provider (`bg3-hub-claim.provider.ts`) lists the unclaimed party
 * slots of the hub's ACTIVE campaign (N5) and reports `dismissScope`
 * `campaign-<id>`, so `scopedDismissal` makes a dismissal hold for that
 * campaign only (N4): a new active campaign asks again. List only — no
 * suggested match (N3), no options step (`claimOptions: 'none'`).
 *
 * After a claim the Party widget (and every other BG3 query of the hub) refetches
 * through `invalidateBg3Hub`, the same refresh the Party tile's own claim runs.
 */
import type { QueryClient } from '@tanstack/react-query';
import { BG3_GAME_SLUGS, type HubClaimResult } from '@raid-ledger/contract';
import type { HubClaimCopy, HubClaimProvider } from '../../../components/hub/claim/hub-claim-providers';
import { invalidateBg3Hub } from '../hooks/bg3-keys';

/** BG3 wording in the core prompt's voice; the button keeps the core "Pick my character". */
export const BG3_HUB_CLAIM_COPY = {
    heading: 'Playing in this campaign?',
    body: 'Pick the party character you play, so the Party card shows who plays whom.',
    shortBody: 'Pick the party character you play.',
} as const satisfies HubClaimCopy;

export function invalidateBg3AfterHubClaim(_result: HubClaimResult, qc: QueryClient, guildId: number): Promise<void> {
    return invalidateBg3Hub(qc, guildId);
}

export const bg3HubClaimProvider: HubClaimProvider = {
    games: [...BG3_GAME_SLUGS],
    kinds: ['game_community'],
    copy: BG3_HUB_CLAIM_COPY,
    scopedDismissal: true,
    onClaimed: invalidateBg3AfterHubClaim,
};

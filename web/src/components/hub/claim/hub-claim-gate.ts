/** ROK-2153 S3b — the status half of the claim prompt's gate (pure, for the cell and its tests). */
import type { HubClaimStatus } from '@raid-ledger/contract';
import type { HubClaimProvider } from './hub-claim-providers';

/** Does this status call for the prompt? Membership comes from the server (api D4), never the staff ladder. */
export function shouldShowClaimPrompt(status: HubClaimStatus): boolean {
    return status.viewerIsMember && !status.viewerHasClaim && status.unclaimedCount >= 1;
}

/**
 * Fail closed: a hub whose claim needs options (e.g. a WoW ruleset) is claimable
 * from the core cell only when its provider registered an `OptionsStep`. Never
 * post a claim without the options the server asked for.
 */
export function canClaimFromCore(status: HubClaimStatus, provider: HubClaimProvider): boolean {
    return status.claimOptions === 'none' || provider.OptionsStep !== undefined;
}

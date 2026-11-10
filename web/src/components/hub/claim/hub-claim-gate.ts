/** ROK-2153 S3b — the status half of the claim prompt's gate (pure, for the cell and its tests). */
import type { HubClaimStatus } from '@raid-ledger/contract';

/** Does this status call for the prompt? Membership comes from the server (api D4), never the staff ladder. */
export function shouldShowClaimPrompt(status: HubClaimStatus): boolean {
    return status.viewerIsMember && !status.viewerHasClaim && status.unclaimedCount >= 1;
}

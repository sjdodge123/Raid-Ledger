/**
 * ROK-1701 D-16 / OQ-8e: the claim hook R10 subscribes to (relay boot
 * registration). Emitted AFTER the claim transaction commits. No relay code
 * here — this story only emits.
 */
export const SETUP_CLAIM_EVENTS = {
  CLAIMED: 'setup.claimed',
} as const;

export interface SetupClaimedPayload {
  userId: number;
  /** ISO time the claim was recorded (`claimed_at`). */
  claimedAt: string;
}

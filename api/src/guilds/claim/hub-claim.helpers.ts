import {
  HubClaimRequestSchema,
  MAX_HUB_CLAIM_CANDIDATES,
  type HubClaimCandidate,
  type HubClaimRequest,
} from '@raid-ledger/contract';
import { HubClaimError } from './hub-claim.errors';

/**
 * ROK-2153 D5: the one "obvious match" — exactly one `strong` candidate, else
 * null (0 or ≥2 strong). Core recomputes it; a provider cannot suggest.
 */
export function pickSuggested(
  candidates: readonly HubClaimCandidate[],
): HubClaimCandidate | null {
  const strong = candidates.filter((c) => c.match === 'strong');
  return strong.length === 1 ? (strong[0] ?? null) : null;
}

/** First `MAX_HUB_CLAIM_CANDIDATES` candidates plus whether any were cut. */
export function capCandidates(list: readonly HubClaimCandidate[]): {
  candidates: HubClaimCandidate[];
  truncated: boolean;
} {
  return {
    candidates: list.slice(0, MAX_HUB_CLAIM_CANDIDATES),
    truncated: list.length > MAX_HUB_CLAIM_CANDIDATES,
  };
}

/** The POST body, or `HUB_CLAIM_BAD_OPTIONS` (400). A missing body is `{}`. */
export function parseClaimBody(body: unknown): HubClaimRequest {
  const parsed = HubClaimRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new HubClaimError('HUB_CLAIM_BAD_OPTIONS', 'Invalid claim options');
  }
  return parsed.data;
}

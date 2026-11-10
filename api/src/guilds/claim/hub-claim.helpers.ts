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

/**
 * First `MAX_HUB_CLAIM_CANDIDATES` candidates plus whether any were cut. Pass
 * the `suggested` pick (computed over the FULL list) as `keep`: when it sits
 * past the cutoff it takes the last slot, so the schema's "suggested is in
 * candidates" refine holds and the client can still show it.
 */
export function capCandidates(
  list: readonly HubClaimCandidate[],
  keep: HubClaimCandidate | null = null,
): {
  candidates: HubClaimCandidate[];
  truncated: boolean;
} {
  const head = list.slice(0, MAX_HUB_CLAIM_CANDIDATES);
  const candidates =
    keep === null || head.includes(keep)
      ? head
      : [...head.slice(0, MAX_HUB_CLAIM_CANDIDATES - 1), keep];
  return { candidates, truncated: list.length > MAX_HUB_CLAIM_CANDIDATES };
}

/** The POST body, or `HUB_CLAIM_BAD_OPTIONS` (400). A missing body is `{}`. */
export function parseClaimBody(body: unknown): HubClaimRequest {
  const parsed = HubClaimRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new HubClaimError('HUB_CLAIM_BAD_OPTIONS', 'Invalid claim options');
  }
  return parsed.data;
}

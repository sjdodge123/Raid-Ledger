/**
 * ROK-1955: per-key budgets for the device-link routes, on the shared
 * fixed-window limiter. Keys carry the raw IP / user id only in memory —
 * never a code or a token.
 */
import { rateLimited } from '../../common/rate-limit/env-limit.helpers';
import type { FixedWindowRateLimiter } from '../../common/rate-limit/fixed-window-rate-limiter';

/** The response surface the budgets need (Retry-After). */
export interface HeaderSink {
  setHeader(name: string, value: string): unknown;
}

/** One budget: `limit` (null = unlimited) per `windowMs` for `key`. */
export interface BudgetSpec {
  key: string;
  limit: number | null;
  windowMs: number;
}

/** Count one hit; 429 + Retry-After once the window is spent. */
export function hitOrThrow(
  limiter: FixedWindowRateLimiter,
  res: HeaderSink,
  spec: BudgetSpec,
  message: string,
): void {
  if (spec.limit === null) return;
  const hit = limiter.hit(spec.key, spec.limit, spec.windowMs);
  if (hit.allowed) return;
  res.setHeader('Retry-After', String(hit.retryAfterSec));
  throw rateLimited(message);
}

/**
 * Reserve one in-flight attempt on every budget BEFORE the lookup (so a
 * burst cannot outrun the count). Any budget spent → release the others,
 * 429 + Retry-After. Returns `settle(failed)`: a failure becomes a counted
 * hit on every budget, a success refunds the slots.
 */
export function reserveOrThrow(
  limiter: FixedWindowRateLimiter,
  res: HeaderSink,
  specs: readonly BudgetSpec[],
  message: string,
): (failed: boolean) => void {
  const held: Array<BudgetSpec & { limit: number }> = [];
  const settle = (failed: boolean): void => {
    for (const s of held) limiter.settle(s.key, failed, s.limit, s.windowMs);
  };
  for (const spec of specs) {
    const { limit } = spec;
    if (limit === null) continue;
    if (!limiter.reserve(spec.key, limit)) {
      settle(false);
      res.setHeader('Retry-After', String(limiter.retryAfter(spec.key)));
      throw rateLimited(message);
    }
    held.push({ ...spec, limit });
  }
  return settle;
}

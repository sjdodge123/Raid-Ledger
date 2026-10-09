/**
 * ROK-1727: a Wowhead resolver that never touches the network, wired into
 * the shared integration TestApp so every spec that imports a WoW: Forever
 * char section (which enqueues gear post-commit with the kill switch ON by
 * default) gets an instant 404 miss instead of a throttled real request to
 * nether.wowhead.com that outlives the test.
 *
 * Specs read the recorded URLs through the app (`app.get(WOWHEAD_RESOLVER_DEPS)`),
 * not through this module — the TestApp is a cross-file singleton, so a
 * module-scoped import would see a different instance. Specs that need hits
 * still spy on `fetchWowheadItem` (one layer above `fetchFn`).
 */
import type { WowheadResolverDeps } from '../../plugins/wow-common/wowhead-item/wow-item-meta.resolve';
import { createWowheadLimiter } from '../../plugins/wow-common/wowhead-item/wowhead-item.limiter';

/** The 404 body Wowhead returns for an unknown item. */
export const WOWHEAD_MISS_BODY = { error: 'Entity not found' };

export interface NoNetworkWowheadDeps extends WowheadResolverDeps {
  /** Every URL the resolver asked for, in order. */
  readonly calls: string[];
}

export function noNetworkWowheadDeps(): NoNetworkWowheadDeps {
  const calls: string[] = [];
  return {
    calls,
    fetchFn: (url) => {
      calls.push(url);
      return Promise.resolve({
        status: 404,
        json: () => Promise.resolve(WOWHEAD_MISS_BODY),
      });
    },
    limiter: createWowheadLimiter({ minIntervalMs: 0 }),
    wait: () => Promise.resolve(),
    now: () => new Date(),
  };
}

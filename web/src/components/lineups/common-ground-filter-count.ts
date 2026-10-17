import type { CommonGroundParams } from '../../lib/api-client';

/**
 * ROK-1659: the badge counts ONLY the co-op filter. Min owners and the
 * auto-seeded player count are defaults, not user-applied filters. A dormant
 * co-op control (no Co-Optimus data) is withheld from the request, so it
 * never counts either.
 */
export function commonGroundActiveFilterCount(
    filters: CommonGroundParams,
    coopDataAvailable: boolean | undefined,
): number {
    return coopDataAvailable && filters.minOnlineCoop != null ? 1 : 0;
}

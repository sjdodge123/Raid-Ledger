/** ROK-2212 — the Suggested groups widget's footnote copy (pool counts, unclaimed rows included). */
import type { SuggestedGroupsPoolDto } from '@raid-ledger/contract';

/** "From 2 tanks, 3 healers and 9 DPS (4 unclaimed). Left out: 1 with no role, 2 with no level." */
export function poolFootnote(pool: SuggestedGroupsPoolDto): string {
    const base = `From ${pool.tank} tank${pool.tank === 1 ? '' : 's'}, ${pool.healer} healer${pool.healer === 1 ? '' : 's'} and ${pool.dps} DPS (${pool.unclaimed} unclaimed).`;
    const left = [
        pool.skippedNoRole > 0 ? `${pool.skippedNoRole} with no role` : null,
        pool.skippedNoLevel > 0 ? `${pool.skippedNoLevel} with no level` : null,
    ].filter((s): s is string => s !== null);
    return left.length === 0 ? base : `${base} Left out: ${left.join(', ')}.`;
}

/** ROK-2352 — the per-game hand cap as the instance picker sees it. */
import type { LfgGroupListItemDto } from '@raid-ledger/contract';
import { LFG_HAND_CAP } from '../../../hooks/use-lfg-join';

/** New hands the picks would raise, and whether no more fit under the cap. */
export function wowLfgPickCap(groups: readonly LfgGroupListItemDto[], picked: readonly string[]): {
    held: ReadonlySet<string>; atCap: boolean;
} {
    const held = new Set(groups.filter((g) => g.hasOwnIntent).map((g) => g.groupKey ?? ''));
    const fresh = picked.filter((k) => !held.has(k)).length;
    return { held, atCap: held.size + fresh >= LFG_HAND_CAP };
}

/**
 * True when submitting these picks would raise more hands than the cap allows
 * (review r2): no picks raises the Any group, which may itself be a new hand.
 */
export function wowLfgPickBlocked(groups: readonly LfgGroupListItemDto[], picked: readonly string[]): boolean {
    const { held } = wowLfgPickCap(groups, picked);
    const keys = picked.length === 0 ? [''] : picked;
    return held.size + keys.filter((k) => !held.has(k)).length > LFG_HAND_CAP;
}

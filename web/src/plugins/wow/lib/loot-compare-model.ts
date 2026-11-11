/**
 * ROK-2176: everything a Boss & Loot row (and the L6 compare popup) needs to
 * show a drop against the viewer's gear — the equipped target, the per-stat
 * deltas, and the "no stats" note when a side has none (D2 / Q4).
 */
import type { BossLootDto, EquipmentItemDto } from '@raid-ledger/contract';
import { compareTarget, type CompareTarget } from './item-compare-slots';
import { diffItems, itemStatsView, sumViews, type StatDelta } from './item-stat-diff';

/** Wowhead dataEnv 16/4 do not serve these expansions' items (spec Q4). */
const NO_STATS_EXPANSIONS = new Set<BossLootDto['expansion']>(['tbc', 'wotlk', 'cata']);

export const NOTE_STATS_NOT_SYNCED = 'Stats not synced';
export const NOTE_EXPANSION_UNSUPPORTED = "Stats aren't available for this expansion";

export interface LootComparison {
    target: CompareTarget;
    /** The equipped item whose iLvl/card the row shows (first target item). */
    shownItem: EquipmentItemDto | undefined;
    /** null when either side's stats are unknown — `note` says why. */
    deltas: StatDelta[] | null;
    note: string | null;
}

function deltasFor(loot: BossLootDto, target: CompareTarget): { deltas: StatDelta[] | null; note: string | null } {
    if (NO_STATS_EXPANSIONS.has(loot.expansion)) return { deltas: null, note: NOTE_EXPANSION_UNSUPPORTED };
    const lootView = itemStatsView(loot);
    if (!lootView) return { deltas: null, note: NOTE_STATS_NOT_SYNCED };
    if (target.items.length === 0) return { deltas: diffItems(lootView, null), note: null };
    const equipped = sumViews(target.items.map((i) => itemStatsView(i)));
    if (!equipped) return { deltas: null, note: NOTE_STATS_NOT_SYNCED };
    return { deltas: diffItems(lootView, equipped), note: null };
}

export function lootComparison(loot: BossLootDto, equippedBySlot: Map<string, EquipmentItemDto>): LootComparison {
    const target = compareTarget(loot.slot, equippedBySlot);
    return { target, shownItem: target.items[0], ...deltasFor(loot, target) };
}

/**
 * ROK-2176: which equipped item(s) a boss-loot drop is compared against.
 * Rings/trinkets → the weaker of the pair (D1); Two-Hand → Main Hand + Off
 * Hand summed; 1H under an equipped two-hander → the two-hander; off-hand
 * loot under a two-hander → empty (Q7); unmappable slots → no comparison.
 */
import type { EquipmentItemDto } from '@raid-ledger/contract';
import { LOOT_TO_EQUIP_SLOT } from '../slots/boss-loot-constants';
import { itemStatsView } from './item-stat-diff';

export type CompareMode = 'single' | 'weaker' | 'sum' | 'vs-two-hander' | 'empty-two-hander' | 'none';

export interface CompareTarget {
    /** Equipped items to diff against (summed). Empty = compare vs an empty slot. */
    items: EquipmentItemDto[];
    label: string | null;
    mode: CompareMode;
}

const NONE: CompareTarget = { items: [], label: null, mode: 'none' };
const OFF_HAND_LOOT = new Set(['Off Hand', 'Held In Off-hand', 'Shield']);
const MAIN_HAND_LOOT = new Set(['One-Hand', 'Main Hand']);
const PAIRS: Record<string, { slots: [string, string]; noun: string; label: string }> = {
    Finger: { slots: ['FINGER_1', 'FINGER_2'], noun: 'ring', label: 'Ring' },
    Trinket: { slots: ['TRINKET_1', 'TRINKET_2'], noun: 'trinket', label: 'Trinket' },
};

function positiveStatSum(item: EquipmentItemDto): number {
    const view = itemStatsView(item);
    return (view?.stats ?? []).reduce((sum, s) => sum + Math.max(0, s.value), 0);
}

/** Lower iLvl; tie → lower sum of positive stats; tie → slot 1. */
function isSecondWeaker(a: EquipmentItemDto, b: EquipmentItemDto): boolean {
    if (a.itemLevel !== b.itemLevel) return b.itemLevel < a.itemLevel;
    return positiveStatSum(b) < positiveStatSum(a);
}

function weakerOfPair(lootSlot: string, eq: Map<string, EquipmentItemDto>): CompareTarget {
    const pair = PAIRS[lootSlot];
    if (!pair) return NONE;
    const [s1, s2] = pair.slots;
    const a = eq.get(s1);
    const b = eq.get(s2);
    if (!a) return { items: [], label: `vs empty ${pair.label} 1`, mode: 'weaker' };
    if (!b) return { items: [], label: `vs empty ${pair.label} 2`, mode: 'weaker' };
    const second = isSecondWeaker(a, b);
    return {
        items: [second ? b : a],
        label: `vs ${pair.label} ${second ? 2 : 1} — your weaker ${pair.noun}`,
        mode: 'weaker',
    };
}

function isTwoHander(item: EquipmentItemDto | undefined): item is EquipmentItemDto {
    return item?.tooltip?.slotLabel === 'Two-Hand';
}

function weaponTarget(lootSlot: string, eq: Map<string, EquipmentItemDto>): CompareTarget | null {
    const mh = eq.get('MAIN_HAND');
    const oh = eq.get('OFF_HAND');
    if (lootSlot === 'Two-Hand' && oh) {
        return { items: mh ? [mh, oh] : [oh], label: 'vs Main Hand + Off Hand', mode: 'sum' };
    }
    if (MAIN_HAND_LOOT.has(lootSlot) && isTwoHander(mh)) {
        return { items: [mh], label: 'vs your two-hander', mode: 'vs-two-hander' };
    }
    if (OFF_HAND_LOOT.has(lootSlot) && isTwoHander(mh)) {
        return { items: [], label: 'you wield a two-hander', mode: 'empty-two-hander' };
    }
    return null;
}

/** The equipped side a loot row (and its popup) compares against. */
export function compareTarget(
    lootSlot: string | null | undefined,
    equippedBySlot: Map<string, EquipmentItemDto>,
): CompareTarget {
    if (!lootSlot) return NONE;
    if (PAIRS[lootSlot]) return weakerOfPair(lootSlot, equippedBySlot);
    const weapon = weaponTarget(lootSlot, equippedBySlot);
    if (weapon) return weapon;
    const slot = LOOT_TO_EQUIP_SLOT[lootSlot];
    if (!slot) return NONE;
    const item = equippedBySlot.get(slot);
    return { items: item ? [item] : [], label: null, mode: 'single' };
}

import { describe, expect, it } from 'vitest';
import type { BossLootDto, EquipmentItemDto, ItemTooltip } from '@raid-ledger/contract';
import { compareTarget } from './item-compare-slots';
import { lootComparison, NOTE_EXPANSION_UNSUPPORTED, NOTE_STATS_NOT_SYNCED } from './loot-compare-model';

function tip(slotLabel: string, stats: [string, number][] = [], armor: number | null = null): ItemTooltip {
    return {
        env: 4, slotLabel, subclass: null, binding: null, unique: false, requiredLevel: null, armor,
        weapon: null, stats: stats.map(([key, value]) => ({ key, name: key, value, unit: 'flat' })),
        effects: [], setName: null, randomEnchant: false,
    };
}

function eq(slot: string, itemLevel: number, tooltip?: ItemTooltip): EquipmentItemDto {
    return { slot, name: `${slot} item`, itemId: itemLevel * 10, quality: 'Rare', itemLevel, itemSubclass: null, ...(tooltip ? { tooltip } : {}) };
}

function gear(...items: EquipmentItemDto[]): Map<string, EquipmentItemDto> {
    return new Map(items.map((i) => [i.slot, i]));
}

function loot(slot: string, over: Partial<BossLootDto> = {}): BossLootDto {
    return {
        id: 1, bossId: 1, itemId: 999, itemName: 'Drop', slot, quality: 'Epic', itemLevel: 70, dropRate: null,
        expansion: 'classic', classRestrictions: null, iconUrl: null, itemSubclass: null, ...over,
    };
}

describe('compareTarget — rings and trinkets (D1)', () => {
    it('compares against the lower-iLvl ring, labelled', () => {
        const t = compareTarget('Finger', gear(eq('FINGER_1', 60), eq('FINGER_2', 55)));
        expect(t.items.map((i) => i.slot)).toEqual(['FINGER_2']);
        expect(t.label).toBe('vs Ring 2 — your weaker ring');
    });

    it('breaks an iLvl tie by the lower positive stat sum, then slot 1', () => {
        const strong = eq('TRINKET_1', 60, tip('Trinket', [['STAMINA', 10]]));
        const weak = eq('TRINKET_2', 60, tip('Trinket', [['STAMINA', 4]]));
        expect(compareTarget('Trinket', gear(strong, weak)).label).toBe('vs Trinket 2 — your weaker trinket');
        expect(compareTarget('Finger', gear(eq('FINGER_1', 60), eq('FINGER_2', 60))).label).toBe('vs Ring 1 — your weaker ring');
    });

    it('compares against an empty ring slot', () => {
        const t = compareTarget('Finger', gear(eq('FINGER_1', 60)));
        expect(t).toEqual({ items: [], label: 'vs empty Ring 2', mode: 'weaker' });
    });
});

describe('compareTarget — weapons', () => {
    it('Two-Hand loot vs Main Hand + Off Hand', () => {
        const t = compareTarget('Two-Hand', gear(eq('MAIN_HAND', 60, tip('One-Hand')), eq('OFF_HAND', 58)));
        expect(t.items.map((i) => i.slot)).toEqual(['MAIN_HAND', 'OFF_HAND']);
        expect(t.label).toBe('vs Main Hand + Off Hand');
    });

    it('One-Hand loot under an equipped two-hander compares vs the two-hander', () => {
        const t = compareTarget('One-Hand', gear(eq('MAIN_HAND', 60, tip('Two-Hand'))));
        expect(t).toMatchObject({ label: 'vs your two-hander', mode: 'vs-two-hander' });
        expect(t.items).toHaveLength(1);
    });

    it('Off-hand loot under a two-hander compares vs empty (Q7)', () => {
        const t = compareTarget('Shield', gear(eq('MAIN_HAND', 60, tip('Two-Hand')), eq('OFF_HAND', 50)));
        expect(t).toEqual({ items: [], label: 'you wield a two-hander', mode: 'empty-two-hander' });
    });

    it('Off-hand loot without a two-hander compares vs the off hand', () => {
        expect(compareTarget('Held In Off-hand', gear(eq('OFF_HAND', 50))).items.map((i) => i.slot)).toEqual(['OFF_HAND']);
    });
});

describe('compareTarget — plain and unmappable slots', () => {
    it('maps a plain slot', () => {
        expect(compareTarget('Legs', gear(eq('LEGS', 60)))).toMatchObject({ mode: 'single', label: null });
    });

    it('returns none for an unmappable or missing slot', () => {
        expect(compareTarget('Relic', gear()).mode).toBe('none');
        expect(compareTarget(null, gear()).mode).toBe('none');
    });
});

describe('lootComparison — notes (D2 / Q4)', () => {
    const legs = eq('LEGS', 60, tip('Legs', [['STAMINA', 8]], 90));

    it('diffs a synced drop against the equipped item', () => {
        const c = lootComparison(loot('Legs', { tooltip: tip('Legs', [['STAMINA', 12]], 100) }), gear(legs));
        expect(c.note).toBeNull();
        expect(c.deltas?.map((d) => [d.key, d.value])).toEqual([['STAMINA', 4], ['ARMOR', 10]]);
    });

    it('says "stats not synced" when the drop has no tooltip', () => {
        expect(lootComparison(loot('Legs'), gear(legs))).toMatchObject({ deltas: null, note: NOTE_STATS_NOT_SYNCED });
    });

    it('says "stats not synced" when the equipped item has no stats', () => {
        const c = lootComparison(loot('Legs', { tooltip: tip('Legs', [['STAMINA', 12]]) }), gear(eq('LEGS', 60)));
        expect(c).toMatchObject({ deltas: null, note: NOTE_STATS_NOT_SYNCED });
    });

    it('says stats are unavailable for TBC/Wrath/Cata loot', () => {
        const c = lootComparison(loot('Legs', { expansion: 'wotlk', tooltip: tip('Legs', [['STAMINA', 12]]) }), gear(legs));
        expect(c).toMatchObject({ deltas: null, note: NOTE_EXPANSION_UNSUPPORTED });
    });
});

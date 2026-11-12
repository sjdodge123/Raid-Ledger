import { describe, expect, it } from 'vitest';
import type { ItemTooltip } from '@raid-ledger/contract';
import {
    diffItems, formatDelta, itemStatsView, statKeyFromName, sumViews, topDeltas,
    type StatsView,
} from './item-stat-diff';

function tooltip(over: Partial<ItemTooltip> = {}): ItemTooltip {
    return {
        env: 4, slotLabel: 'Legs', subclass: 'Cloth', binding: null, unique: false, requiredLevel: 60,
        armor: 100, weapon: null, stats: [], effects: [], setName: null, randomEnchant: false, ...over,
    };
}

function view(stats: [string, number][], armor: number | null = null, dps: number | null = null): StatsView {
    return { stats: stats.map(([key, value]) => ({ key, name: key, value, unit: 'flat' })), armor, dps };
}

function byKey(deltas: { key: string; value: number }[]): Record<string, number> {
    return Object.fromEntries(deltas.map((d) => [d.key, d.value]));
}

describe('itemStatsView — source pick (L3)', () => {
    it('prefers the Wowhead tooltip over Blizzard stats', () => {
        const v = itemStatsView({
            tooltip: tooltip({ stats: [{ key: 'STAMINA', name: 'Stamina', value: 12, unit: 'flat' }] }),
            stats: [{ type: 'STAMINA', name: 'Stamina', value: 99 }],
        });
        expect(v?.stats).toEqual([{ key: 'STAMINA', name: 'Stamina', value: 12, unit: 'flat' }]);
        expect(v?.armor).toBe(100);
    });

    it('falls back to Blizzard stats for a random-enchant tooltip, keyed by name', () => {
        const v = itemStatsView({
            tooltip: tooltip({ randomEnchant: true }),
            stats: [{ type: 'FIRE_RESISTANCE_X', name: 'Fire Resistance', value: 10 }], armor: 50,
        });
        expect(v).toEqual({ stats: [{ key: 'FIRE_RESISTANCE', name: 'Fire Resistance', value: 10, unit: 'flat' }], armor: 50, dps: null });
    });

    it('returns null when nothing is known (stats not synced)', () => {
        expect(itemStatsView({ tooltip: null })).toBeNull();
        expect(itemStatsView({})).toBeNull();
    });

    it('reads weapon DPS from the tooltip and keeps the percent unit', () => {
        const v = itemStatsView({ tooltip: tooltip({
            armor: null, weapon: { damageMin: 223, damageMax: 372, attackSpeed: 3.7, dps: 80.41 },
            stats: [{ key: 'CRIT_PCT', name: 'Critical Strike', value: 1, unit: 'percent' }],
        }) });
        expect(v?.dps).toBe(80.41);
        expect(v?.stats[0]?.unit).toBe('percent');
    });

    it('derives UPPER_SNAKE keys from names', () => {
        expect(statKeyFromName(' Attack Power ')).toBe('ATTACK_POWER');
    });
});

describe('diffItems', () => {
    it('gains a key missing on the equipped side and loses one missing on the loot side', () => {
        const d = diffItems(view([['STAMINA', 12], ['STRENGTH', 5]]), view([['STAMINA', 8], ['SPIRIT', 6]]));
        expect(byKey(d)).toEqual({ STAMINA: 4, STRENGTH: 5, SPIRIT: -6 });
    });

    it('adds ARMOR and DPS deltas (DPS rounded to 1 dp) and keeps zero deltas', () => {
        const d = diffItems(view([['STAMINA', 8]], 120, 80.41), view([['STAMINA', 8]], 100, 70.27));
        expect(byKey(d)).toEqual({ STAMINA: 0, ARMOR: 20, DPS: 10.1 });
    });

    it('treats an empty slot (null) as all gains', () => {
        expect(byKey(diffItems(view([['STAMINA', 8]], 40), null))).toEqual({ STAMINA: 8, ARMOR: 40 });
    });
});

describe('sumViews (Two-Hand vs MH + OH)', () => {
    it('sums stats and armor, takes the main-hand DPS', () => {
        const s = sumViews([view([['STAMINA', 5]], null, 40), view([['STAMINA', 3], ['SPIRIT', 2]], 1500, null)]);
        expect(s).toEqual({ stats: [
            { key: 'STAMINA', name: 'STAMINA', value: 8, unit: 'flat' },
            { key: 'SPIRIT', name: 'SPIRIT', value: 2, unit: 'flat' },
        ], armor: 1500, dps: 40 });
    });

    it('is unknown when any side is unknown', () => {
        expect(sumViews([view([['STAMINA', 5]]), null])).toBeNull();
    });
});

describe('topDeltas (phone rows, Q2)', () => {
    it('ranks the 3 largest |stat changes|, never ARMOR/BONUS_ARMOR/DPS, and counts the rest', () => {
        const deltas = diffItems(
            view([['STAMINA', 12], ['STRENGTH', 1], ['SPIRIT', 0], ['BONUS_ARMOR', 400], ['AGILITY', 3]], 900, 50),
            view([['INTELLECT', 7], ['SPIRIT', 0]], 100, 10),
        );
        const { shown, more } = topDeltas(deltas, 3);
        expect(shown.map((d) => d.key)).toEqual(['STAMINA', 'INTELLECT', 'AGILITY']);
        // STRENGTH, BONUS_ARMOR, ARMOR, DPS — SPIRIT (0) is not a change
        expect(more).toBe(4);
    });
});

describe('formatDelta', () => {
    it('signs and units the label', () => {
        expect(formatDelta({ key: 'STAMINA', name: 'Stamina', value: 12, unit: 'flat' })).toBe('▲ +12 Stamina');
        expect(formatDelta({ key: 'CRIT_PCT', name: 'Crit', value: -1, unit: 'percent' })).toBe('▼ −1% Crit');
        expect(formatDelta({ key: 'DPS', name: 'DPS', value: 10.14, unit: 'flat' })).toBe('▲ +10.1 DPS');
        expect(formatDelta({ key: 'SPIRIT', name: 'Spirit', value: 0, unit: 'flat' })).toBe('= Spirit');
    });
});

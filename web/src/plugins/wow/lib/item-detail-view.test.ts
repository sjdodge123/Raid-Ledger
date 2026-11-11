import { describe, expect, it } from 'vitest';
import type { EquipmentItemDto, ItemTooltip } from '@raid-ledger/contract';
import { toDetailItem } from './item-detail-view';
import { itemStatsView } from './item-stat-diff';

const ARMORY_WEAPON = { damageMin: 30, damageMax: 50, attackSpeed: 2, dps: 20 };
const TOOLTIP_WEAPON = { damageMin: 50, damageMax: 70, attackSpeed: 2, dps: 30 };

function tooltip(over: Partial<ItemTooltip> = {}): ItemTooltip {
    return {
        env: 16, slotLabel: 'Main Hand', subclass: 'Mace', binding: null, unique: false, requiredLevel: 60,
        armor: null, weapon: TOOLTIP_WEAPON, stats: [], effects: [], setName: null, randomEnchant: false, ...over,
    };
}

function sword(over: Partial<EquipmentItemDto> = {}): EquipmentItemDto {
    return {
        slot: 'MAIN_HAND', name: 'Old Mace', itemId: 100, quality: 'RARE', itemLevel: 60, itemSubclass: 'Mace',
        weapon: ARMORY_WEAPON, tooltip: tooltip(), ...over,
    };
}

// Codex P2: the displayed DPS must be the one the DPS delta was computed from.
describe('toDetailItem — equipped weapon follows the stats source (ROK-2176)', () => {
    it('shows the tooltip weapon when the tooltip is the stats source', () => {
        const item = sword();
        expect(toDetailItem(item, 'classic_era').weapon?.dps).toBe(itemStatsView(item)?.dps);
        expect(toDetailItem(item, 'classic_era').weapon?.dps).toBe(30);
    });

    it('shows the Armory weapon for a random-enchant item (Armory is the stats source)', () => {
        const item = sword({ tooltip: tooltip({ randomEnchant: true }) });
        expect(toDetailItem(item, 'classic_era').weapon?.dps).toBe(itemStatsView(item)?.dps);
        expect(toDetailItem(item, 'classic_era').weapon?.dps).toBe(20);
    });

    it('shows no weapon line when the stats-source tooltip has none', () => {
        const item = sword({ tooltip: tooltip({ weapon: null }) });
        expect(itemStatsView(item)?.dps).toBeNull();
        expect(toDetailItem(item, 'classic_era').weapon).toBeNull();
    });
});

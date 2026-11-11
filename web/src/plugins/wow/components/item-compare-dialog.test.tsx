import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BossLootDto, EquipmentItemDto, ItemTooltip } from '@raid-ledger/contract';
import { ItemCompareDialog } from './item-compare-dialog';
import { BossLootBody } from '../slots/boss-loot-body';
import { lootComparison, NOTE_EXPANSION_UNSUPPORTED, NOTE_STATS_NOT_SYNCED } from '../lib/loot-compare-model';

const media = vi.hoisted(() => ({ phone: false }));
vi.mock('../../../hooks/use-media-query', () => ({ useMediaQuery: () => media.phone }));

function tooltip(over: Partial<ItemTooltip> = {}): ItemTooltip {
    return {
        env: 4, slotLabel: 'Legs', subclass: 'Cloth', binding: 'Binds when picked up', unique: false, requiredLevel: 60,
        armor: 100, weapon: null, stats: [], effects: [], setName: null, randomEnchant: false, ...over,
    };
}

const stat = (key: string, name: string, value: number) => ({ key, name, value, unit: 'flat' as const });

const LOOT: BossLootDto = {
    id: 1, bossId: 7, itemId: 16915, itemName: 'Netherwind Pants', slot: 'Legs', quality: 'Epic', itemLevel: 66,
    dropRate: null, expansion: 'classic', classRestrictions: null, iconUrl: null, itemSubclass: 'Cloth',
    tooltip: tooltip({ stats: [stat('STAMINA', 'Stamina', 12), stat('SPIRIT', 'Spirit', 5)] }),
};

const EQUIPPED: EquipmentItemDto = {
    slot: 'LEGS', name: 'Old Leggings', itemId: 100, quality: 'RARE', itemLevel: 60, itemSubclass: 'Cloth',
    tooltip: tooltip({ armor: 90, stats: [stat('STAMINA', 'Stamina', 8), stat('INTELLECT', 'Intellect', 4)] }),
};

const EQUIP_MAP = new Map([['LEGS', EQUIPPED]]);

function renderDialog(loot: BossLootDto = LOOT, equipped: Map<string, EquipmentItemDto> = EQUIP_MAP) {
    const onClose = vi.fn();
    render(<ItemCompareDialog loot={loot} comparison={lootComparison(loot, equipped)} gameVariant="classic_era" onClose={onClose} />);
    return onClose;
}

const lootColumn = () => screen.getByTestId('compare-loot-column');
const equippedColumn = () => screen.getByTestId('compare-equipped-column');
const deltaTexts = (el: HTMLElement) => within(el).queryAllByTestId('line-delta').map((d) => d.textContent);

describe('ItemCompareDialog (ROK-2176 layout A)', () => {
    beforeEach(() => { media.phone = false; });
    afterEach(() => { vi.restoreAllMocks(); });

    it('desktop: a Modal with loot and equipped side by side, deltas on the loot column only', () => {
        renderDialog();
        const dialog = screen.getByRole('dialog', { name: 'Compare: Legs' });
        expect(within(dialog).getByTestId('item-compare-dialog')).toHaveAttribute('data-layout', 'columns');
        expect(within(lootColumn()).getByText('Netherwind Pants')).toBeInTheDocument();
        expect(within(equippedColumn()).getByText('Old Leggings')).toBeInTheDocument();
        expect(deltaTexts(lootColumn())).toEqual(['▲ +6 iLvl', '▲ +10', '▲ +4', '▲ +5', '▼ −4']);
        expect(within(lootColumn()).getByText(/\(equipped only\)/)).toHaveTextContent('+4 Intellect (equipped only)');
        expect(deltaTexts(equippedColumn())).toEqual([]);
    });

    it('phone: a BottomSheet stacking "This drop" above "Equipped (label)"', () => {
        media.phone = true;
        renderDialog({ ...LOOT, slot: 'Finger', tooltip: tooltip({ slotLabel: 'Finger', armor: null }) },
            new Map([['FINGER_1', { ...EQUIPPED, slot: 'FINGER_1', itemLevel: 70 }], ['FINGER_2', { ...EQUIPPED, slot: 'FINGER_2', name: 'Weak Ring', itemLevel: 50 }]]));
        expect(screen.getByTestId('item-compare-dialog')).toHaveAttribute('data-layout', 'stacked');
        expect(within(lootColumn()).getByText('This drop')).toBeInTheDocument();
        expect(within(equippedColumn()).getByText('Equipped (vs Ring 2 — your weaker ring)')).toBeInTheDocument();
        expect(within(equippedColumn()).getByText('Weak Ring')).toBeInTheDocument();
        expect(lootColumn().compareDocumentPosition(equippedColumn()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('a loot side without stats shows "Stats not synced" and still the iLvl delta', () => {
        renderDialog({ ...LOOT, tooltip: null });
        expect(within(lootColumn()).getByTestId('stats-not-synced')).toHaveTextContent(NOTE_STATS_NOT_SYNCED);
        expect(deltaTexts(lootColumn())).toEqual(['▲ +6 iLvl']);
        expect(within(equippedColumn()).queryByTestId('stats-not-synced')).toBeNull();
    });

    it('an equipped side without stats gets the panel; TBC loot gets the expansion copy', () => {
        renderDialog({ ...LOOT, expansion: 'tbc' }, new Map([['LEGS', { ...EQUIPPED, tooltip: undefined }]]));
        expect(within(equippedColumn()).getByTestId('stats-not-synced')).toHaveTextContent(NOTE_STATS_NOT_SYNCED);
        expect(within(lootColumn()).getByTestId('stats-not-synced')).toHaveTextContent(NOTE_EXPANSION_UNSUPPORTED);
    });

    it('closes via × and via Escape', async () => {
        const onClose = renderDialog();
        await userEvent.click(screen.getByRole('button', { name: 'Close modal' }));
        await userEvent.keyboard('{Escape}');
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('phone sheet closes via its ×', async () => {
        media.phone = true;
        const onClose = renderDialog();
        await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('"View on Wowhead" is a button that opens Wowhead in a new tab', async () => {
        const open = vi.spyOn(window, 'open').mockReturnValue(null);
        renderDialog();
        expect(screen.getByRole('dialog').querySelector('a[href*="wowhead"]')).toBeNull();
        await userEvent.click(within(lootColumn()).getByRole('button', { name: /View on Wowhead/ }));
        expect(open).toHaveBeenCalledWith('https://www.wowhead.com/classic/item=16915', '_blank', 'noopener,noreferrer');
    });
});

describe('Boss & Loot row opens the compare popup (ruling A)', () => {
    beforeEach(() => { media.phone = false; });

    function renderRow() {
        render(<BossLootBody loot={[LOOT]} isLoading={false} wowheadVariant="classic_era" equippedBySlot={EQUIP_MAP} hasCharacter />);
    }

    it.each([['the loot card', 'Netherwind Pants'], ['the equipped card', 'Old Leggings']])('tapping %s opens the same dialog', async (_l, name) => {
        renderRow();
        expect(screen.queryByRole('dialog')).toBeNull();
        await userEvent.click(screen.getByRole('link', { name }));
        const dialog = screen.getByRole('dialog', { name: 'Compare: Legs' });
        expect(within(dialog).getByTestId('compare-loot-column')).toHaveTextContent('Netherwind Pants');
        expect(within(dialog).getByTestId('compare-equipped-column')).toHaveTextContent('Old Leggings');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Close modal' }));
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BossLootDto, EquipmentItemDto, ItemTooltip } from '@raid-ledger/contract';
import { ItemCompareDialog } from './item-compare-dialog';
import { BossLootBody } from '../slots/boss-loot-body';
import { lootComparison, NOTE_EXPANSION_UNSUPPORTED, NOTE_STATS_NOT_SYNCED } from '../lib/loot-compare-model';
import { compareTarget } from '../lib/item-compare-slots';
import { ItemDetailBody } from './item-detail-body';

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

const table = () => screen.getByTestId('compare-table');
const tableRows = () => within(table()).getAllByTestId('compare-row');
const rowIds = () => tableRows().map((r) => r.getAttribute('data-row'));
function must<T>(value: T | undefined, label: string): T {
    if (value === undefined) throw new Error(`missing ${label}`);
    return value;
}
const cells = (id: string) => [...must(tableRows().find((r) => r.getAttribute('data-row') === id), `row ${id}`).querySelectorAll('td')].map((td) => td.textContent);
const notes = () => within(table()).queryAllByTestId('stats-not-synced').map((n) => [n.getAttribute('data-side'), n.textContent]);

describe('ItemCompareDialog (ROK-2176 layout A)', () => {
    beforeEach(() => { media.phone = false; });
    afterEach(() => { vi.restoreAllMocks(); });

    it('desktop: a Modal with both heads over one aligned table, one row and one delta per stat key', () => {
        renderDialog();
        const dialog = screen.getByRole('dialog', { name: 'Compare: Legs' });
        expect(within(dialog).getByTestId('item-compare-dialog')).toHaveAttribute('data-layout', 'table');
        expect(within(lootColumn()).getByText('Netherwind Pants')).toBeInTheDocument();
        expect(within(equippedColumn()).getByText('Old Leggings')).toBeInTheDocument();
        expect(within(table()).getByRole('rowheader', { name: 'Stamina' })).toBeInTheDocument();
        expect(rowIds()).toEqual(['ILVL', 'BINDING', 'SLOT', 'ARMOR', 'STAMINA', 'SPIRIT', 'INTELLECT', 'REQ']);
        expect(cells('ILVL')).toEqual(['66', '60', '▲ +6']);
        expect(cells('ARMOR')).toEqual(['100', '90', '▲ +10']);
        expect(cells('STAMINA')).toEqual(['+12', '+8', '▲ +4']);
        expect(cells('SPIRIT')).toEqual(['+5', '—', '▲ +5']);
        expect(cells('INTELLECT')).toEqual(['—', '+4', '▼ −4']);
        expect(deltaTexts(table())).toEqual(['▲ +6', '▲ +10', '▲ +4', '▲ +5', '▼ −4']);
    });

    it('desktop: a weapon on either side adds the Weapon group with a DPS delta', () => {
        const weapon = { damageMin: 50, damageMax: 90, attackSpeed: 2.6, dps: 26.9 };
        renderDialog({ ...LOOT, tooltip: tooltip({ weapon, stats: [stat('STAMINA', 'Stamina', 12)] }) });
        expect(rowIds()).toEqual(['ILVL', 'BINDING', 'SLOT', 'DAMAGE', 'SPEED', 'DPS', 'ARMOR', 'STAMINA', 'INTELLECT', 'REQ']);
        expect(cells('DAMAGE')).toEqual(['50 - 90', '—', '']);
        expect(cells('DPS')).toEqual(['26.9', '—', '▲ +26.9']);
    });

    it('desktop: a negative tooltip stat keeps its sign', () => {
        renderDialog({ ...LOOT, tooltip: tooltip({ stats: [stat('SPIRIT', 'Spirit', -10)] }) });
        expect(cells('SPIRIT')).toEqual(['-10', '—', '▼ −10']);
    });

    it('item body: a negative stat line reads "-10 Spirit", not "+10"', () => {
        render(<ItemDetailBody item={{ ...LOOT, tooltip: tooltip({ stats: [stat('SPIRIT', 'Spirit', -10)] }) }} gameVariant="classic_era" />);
        expect(within(screen.getByTestId('item-stat-lines')).getByText('-10 Spirit')).toBeInTheDocument();
    });

    it('a loot side without stats shows "Stats not synced" in its column and still the iLvl delta', () => {
        renderDialog({ ...LOOT, tooltip: null });
        expect(notes()).toEqual([['loot', NOTE_STATS_NOT_SYNCED]]);
        expect(cells('STAMINA')).toEqual([NOTE_STATS_NOT_SYNCED, '+8', '']);
        expect(deltaTexts(table())).toEqual(['▲ +6']);
    });

    it('an equipped side without stats gets the note; TBC loot gets the expansion copy', () => {
        renderDialog({ ...LOOT, expansion: 'tbc' }, new Map([['LEGS', { ...EQUIPPED, tooltip: undefined }]]));
        expect(notes()).toEqual([['loot', NOTE_EXPANSION_UNSUPPORTED], ['equipped', NOTE_STATS_NOT_SYNCED]]);
    });

    it('an unmappable slot (Relic) has no deltas — nothing to gain against', () => {
        const relic = { ...LOOT, slot: 'Relic', tooltip: tooltip({ slotLabel: 'Relic', armor: null, stats: [stat('STAMINA', 'Stamina', 3)] }) };
        expect(lootComparison(relic, EQUIP_MAP)).toMatchObject({ deltas: null, note: null });
        renderDialog(relic);
        expect(deltaTexts(table())).toEqual([]);
        expect(within(equippedColumn()).getByText('Nothing to compare against')).toBeInTheDocument();
    });

    it('Two-Hand loot with only an off-hand equipped is labelled "vs Off Hand"', () => {
        expect(compareTarget('Two-Hand', new Map([['OFF_HAND', { ...EQUIPPED, slot: 'OFF_HAND' }]]))).toMatchObject({ label: 'vs Off Hand', mode: 'sum' });
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

    it('phone: the drop column keeps its per-line deltas; the equipped column has none', () => {
        media.phone = true;
        renderDialog();
        expect(deltaTexts(lootColumn())).toEqual(['▲ +6 iLvl', '▲ +10', '▲ +4', '▲ +5', '▼ −4']);
        expect(within(lootColumn()).getByText(/\(equipped only\)/)).toHaveTextContent('+4 Intellect (equipped only)');
        expect(deltaTexts(equippedColumn())).toEqual([]);
    });

    // Codex P2: a drop with no armor / weapon line must still show the equipped armor / DPS it loses.
    it('phone: equipped-only armor and DPS show as struck-through losses', () => {
        media.phone = true;
        const weapon = { damageMin: 40, damageMax: 60, attackSpeed: 2, dps: 25 };
        renderDialog({ ...LOOT, tooltip: tooltip({ armor: null, stats: [] }) },
            new Map([['LEGS', { ...EQUIPPED, tooltip: tooltip({ armor: 90, weapon, stats: [] }) }]]));
        const lost = within(lootColumn()).queryAllByText(/\(equipped only\)/).map((el) => el.textContent);
        expect(lost).toEqual(['+90 Armor (equipped only)', '+25 DPS (equipped only)']);
        expect(deltaTexts(lootColumn())).toEqual(['▲ +6 iLvl', '▼ −90', '▼ −25']);
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

    it('desktop: "Loot on Wowhead" and "Equipped on Wowhead" are buttons opening a new tab', async () => {
        const open = vi.spyOn(window, 'open').mockReturnValue(null);
        renderDialog();
        expect(screen.getByRole('dialog').querySelector('a[href*="wowhead"]')).toBeNull();
        await userEvent.click(screen.getByRole('button', { name: 'Loot on Wowhead' }));
        expect(open).toHaveBeenCalledWith('https://www.wowhead.com/classic/item=16915', '_blank', 'noopener,noreferrer');
        await userEvent.click(screen.getByRole('button', { name: 'Equipped on Wowhead' }));
        expect(open).toHaveBeenLastCalledWith(expect.stringContaining('item=100'), '_blank', 'noopener,noreferrer');
    });

    it('phone: "View on Wowhead" stays a button', async () => {
        media.phone = true;
        const open = vi.spyOn(window, 'open').mockReturnValue(null);
        renderDialog();
        await userEvent.click(within(lootColumn()).getByRole('button', { name: /View on Wowhead/ }));
        expect(open).toHaveBeenCalledWith('https://www.wowhead.com/classic/item=16915', '_blank', 'noopener,noreferrer');
    });

    it('hides Wowhead hover tooltips while open (body attribute + CSS rule)', () => {
        const { unmount } = render(<ItemCompareDialog loot={LOOT} comparison={lootComparison(LOOT, EQUIP_MAP)} gameVariant="classic_era" onClose={vi.fn()} />);
        expect(document.body).toHaveAttribute('data-wow-popup-open');
        unmount();
        expect(document.body).not.toHaveAttribute('data-wow-popup-open');
        const css = readFileSync(resolve(__dirname, 'wow-item-card.css'), 'utf-8');
        expect(css).toMatch(/body\[data-wow-popup-open\] \.wowhead-tooltip \{\s*display: none !important;/);
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

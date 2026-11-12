import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EquipmentItemDto } from '@raid-ledger/contract';
import { ItemDetailModal } from './item-detail-modal';
import { CLASSIC_FALLBACK_HINT } from '../lib/item-wowhead-variant';

const ITEM: EquipmentItemDto = {
    slot: 'HEAD',
    name: 'Test Helm',
    itemId: 19019,
    quality: 'EPIC',
    itemLevel: 80,
    itemSubclass: 'Plate',
};

/** ROK-2176: "View on Wowhead" is a button calling window.open (no <a> for Wowhead's tooltips.js to bind). */
function wowheadUrlOpened(): string | undefined {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    fireEvent.click(screen.getByRole('button', { name: /view on wowhead/i }));
    expect(open).toHaveBeenCalledWith(expect.any(String), '_blank', 'noopener,noreferrer');
    const url = open.mock.calls[0]?.[0];
    return typeof url === 'string' ? url : undefined;
}

afterEach(() => { vi.restoreAllMocks(); });

function renderModal(gameVariant: string | null) {
    render(
        <ItemDetailModal isOpen onClose={vi.fn()} items={[ITEM]} currentIndex={0} onNavigate={vi.fn()} gameVariant={gameVariant} />,
    );
    return wowheadUrlOpened();
}

/** ROK-1726: the modal uses the shared Wowhead helper (defect 1 — it had drifted to the legacy classic subdomain). */
describe('ItemDetailModal — View on Wowhead link', () => {
    it.each([
        ['wow_forever', 'https://www.wowhead.com/forever/item=19019'],
        ['classicforever', 'https://www.wowhead.com/forever/item=19019'],
        ['classic_era', 'https://www.wowhead.com/classic/item=19019'],
        ['classic1x', 'https://www.wowhead.com/classic/item=19019'],
        ['classic', 'https://www.wowhead.com/classic/item=19019'],
        ['classic_anniversary', 'https://www.wowhead.com/tbc/item=19019'],
        ['classicann', 'https://www.wowhead.com/tbc/item=19019'],
        ['retail', 'https://www.wowhead.com/item=19019'],
        [null, 'https://www.wowhead.com/item=19019'],
    ])('%j → %s', (variant, href) => {
        expect(renderModal(variant)).toBe(href);
    });
});

/** ROK-1727: per-item Wowhead env (addon gear) + the Classic hint, modal only. */
describe('ItemDetailModal — addon item Wowhead env (ROK-1727)', () => {
    function renderItem(item: EquipmentItemDto) {
        render(<ItemDetailModal isOpen onClose={vi.fn()} items={[item]} currentIndex={0} onNavigate={vi.fn()} gameVariant="wow_forever" />);
        return wowheadUrlOpened();
    }

    it('env 4 links to Wowhead Classic and shows the Classic hint', () => {
        expect(renderItem({ ...ITEM, wowheadEnv: 4 })).toBe('https://www.wowhead.com/classic/item=19019');
        expect(screen.getByText(CLASSIC_FALLBACK_HINT)).toHaveClass('text-xs', 'text-muted');
    });

    it.each<[string, EquipmentItemDto]>([
        ['env 16', { ...ITEM, wowheadEnv: 16 }],
        ['env absent', ITEM],
    ])('%s links to Wowhead Forever with no Classic hint', (_label, item) => {
        expect(renderItem(item)).toBe('https://www.wowhead.com/forever/item=19019');
        expect(screen.queryByText(CLASSIC_FALLBACK_HINT)).toBeNull();
    });
});

/** ROK-2176: the modal moved onto the shared Modal and keeps its pager + ←/→ keys. */
describe('ItemDetailModal — shared Modal + paging (ROK-2176)', () => {
    const ITEMS: EquipmentItemDto[] = [ITEM, { ...ITEM, slot: 'NECK', name: 'Test Amulet', itemId: 2 }, { ...ITEM, slot: 'BACK', name: 'Test Cloak', itemId: 3 }];

    function renderAt(index: number) {
        const onNavigate = vi.fn();
        const onClose = vi.fn();
        render(<ItemDetailModal isOpen onClose={onClose} items={ITEMS} currentIndex={index} onNavigate={onNavigate} gameVariant="classic_era" />);
        return { onNavigate, onClose };
    }

    it('renders as a dialog titled by the slot with a 2 / 3 pager', () => {
        renderAt(1);
        expect(screen.getByRole('dialog', { name: 'Neck' })).toHaveTextContent('Test Amulet');
        expect(screen.getByText('2 / 3')).toBeInTheDocument();
    });

    it('← and → page with wrap-around', () => {
        const { onNavigate } = renderAt(0);
        fireEvent.keyDown(document, { key: 'ArrowLeft' });
        fireEvent.keyDown(document, { key: 'ArrowRight' });
        expect(onNavigate.mock.calls).toEqual([[2], [1]]);
    });

    it('the pager buttons page, and Escape closes', async () => {
        const { onNavigate, onClose } = renderAt(2);
        await userEvent.click(screen.getByRole('button', { name: 'Next item' }));
        await userEvent.click(screen.getByRole('button', { name: 'Previous item' }));
        expect(onNavigate.mock.calls).toEqual([[0], [1]]);
        await userEvent.keyboard('{Escape}');
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

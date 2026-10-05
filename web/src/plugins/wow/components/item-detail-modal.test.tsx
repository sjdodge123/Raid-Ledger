import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { EquipmentItemDto } from '@raid-ledger/contract';
import { ItemDetailModal } from './item-detail-modal';

const ITEM: EquipmentItemDto = {
    slot: 'HEAD',
    name: 'Test Helm',
    itemId: 19019,
    quality: 'EPIC',
    itemLevel: 80,
    itemSubclass: 'Plate',
};

function renderModal(gameVariant: string | null) {
    render(
        <ItemDetailModal isOpen onClose={vi.fn()} items={[ITEM]} currentIndex={0} onNavigate={vi.fn()} gameVariant={gameVariant} />,
    );
    return screen.getByRole('link', { name: /view on wowhead/i }).getAttribute('href');
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

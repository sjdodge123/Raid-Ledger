/** ROK-1836 Codex r9 — the desktop item popover re-clamps on a window resize. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { ValheimItemStack } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    valheimAtlas,
    valheimCatalogue,
} from '../../../test/mocks/valheim-armory-handlers';
import { ItemTile } from './item-tile';
import { clampPopover } from './popover-clamp';
import type { ItemIconContext } from './use-item-icons';

vi.mock('../../../hooks/use-media-query', () => ({
    useMediaQuery: () => true,
}));

const ctx: ItemIconContext = {
    serverId: 7,
    items: valheimCatalogue,
    atlas: valheimAtlas,
    atlasUrl: 'blob:atlas',
};
const sword: ValheimItemStack = {
    prefab: 'SwordIron',
    stack: 1,
    quality: 1,
    variant: 0,
    durability: null,
    maxDurability: null,
};
const ANCHOR = { x: 1250, y: 700, width: 44, height: 44 };
const SIZE = { width: 288, height: 240 };

/** Anchor fixed; the popup's rect follows its own inline style (origin 0,0). */
function mockRects(): void {
    vi.spyOn(
        HTMLElement.prototype,
        'getBoundingClientRect',
    ).mockImplementation(function (this: HTMLElement) {
        if (this.dataset['testid'] !== 'valheim-item-popover')
            return DOMRect.fromRect(ANCHOR);
        return DOMRect.fromRect({
            x: parseFloat(this.style.left) || 0,
            y: parseFloat(this.style.top) || 0,
            ...SIZE,
        });
    });
}

function expectedLeft(viewportWidth: number): string {
    const at = clampPopover({
        anchor: {
            left: ANCHOR.x,
            top: ANCHOR.y,
            bottom: ANCHOR.y + ANCHOR.height,
        },
        size: SIZE,
        viewport: { width: viewportWidth, height: 800 },
    });
    return `${at.left}px`;
}

afterEach(() => {
    vi.restoreAllMocks();
    Object.assign(window, { innerWidth: 1024, innerHeight: 768 });
});

describe('ItemDetail desktop popover — resize', () => {
    it('re-clamps into the viewport when only the viewport edge moves', async () => {
        Object.assign(window, { innerWidth: 1280, innerHeight: 800 });
        mockRects();
        renderWithProviders(<ItemTile item={sword} ctx={ctx} />);
        fireEvent.click(screen.getByRole('button', { name: 'Iron sword' }));
        const pop = await screen.findByTestId('valheim-item-popover');
        await waitFor(() => expect(pop.style.left).toBe(expectedLeft(1280)));
        act(() => {
            Object.assign(window, { innerWidth: 700 });
            window.dispatchEvent(new Event('resize'));
        });
        expect(pop.style.left).toBe(expectedLeft(700));
    });
});

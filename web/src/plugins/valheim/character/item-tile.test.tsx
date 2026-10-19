/** ROK-1836 L3 — item tile faces (D6/D7) and the detail popover / sheet (D11). */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ValheimItemStack } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    valheimAtlas,
    valheimBlobHandler,
    valheimCatalogue,
    VALHEIM_FILE_ICON_SHA,
} from '../../../test/mocks/valheim-armory-handlers';
import { ItemTile } from './item-tile';
import type { ItemIconContext } from './use-item-icons';

const media = vi.hoisted(() => ({ desktop: false }));
vi.mock('../../../hooks/use-media-query', () => ({
    useMediaQuery: () => media.desktop,
}));
vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    getAuthToken: vi.fn(() => 'test-token'),
}));

const ctx = (over: Partial<ItemIconContext> = {}): ItemIconContext => ({
    serverId: 7,
    items: valheimCatalogue,
    atlas: valheimAtlas,
    atlasUrl: 'blob:atlas',
    ...over,
});
const stack = (
    prefab: string,
    over: Partial<ValheimItemStack> = {},
): ValheimItemStack => ({
    prefab,
    stack: 1,
    quality: 1,
    variant: 0,
    durability: null,
    maxDurability: null,
    ...over,
});

const realUrl = {
    createObjectURL: URL.createObjectURL,
    revokeObjectURL: URL.revokeObjectURL,
};
afterEach(() => {
    Object.assign(URL, realUrl);
    vi.restoreAllMocks();
});

beforeEach(() => {
    media.desktop = false;
    Object.assign(URL, {
        createObjectURL: vi.fn(() => 'blob:file-icon'),
        revokeObjectURL: vi.fn(),
    });
});

describe('ItemTile faces — D7 ladder', () => {
    it('catalogue atlas icon renders a CSS sprite over the object URL, named by the catalogue', () => {
        renderWithProviders(<ItemTile item={stack('SwordIron')} ctx={ctx()} />);
        const sprite = screen.getByRole('img', { name: 'Iron sword' });
        expect(sprite.style.backgroundImage).toBe('url("blob:atlas")');
        expect(sprite.style.backgroundPosition).toBe('-32px 0px');
        expect(
            screen.getByRole('button', { name: 'Iron sword' }),
        ).toHaveAttribute('data-kind', 'icon');
    });
    it('atlas not loaded yet → initials tile, never a bare API url', () => {
        const { container } = renderWithProviders(
            <ItemTile
                item={stack('SwordIron')}
                ctx={ctx({ atlasUrl: null })}
            />,
        );
        expect(screen.queryByRole('img')).toBeNull();
        expect(
            container.querySelector('[data-face="initials"]')?.textContent,
        ).toBe('IS');
        expect(container.innerHTML).not.toContain('/blobs/');
    });
    it('catalogue entry with no icon → initials tile with the name', () => {
        renderWithProviders(
            <ItemTile item={stack('Resin', { stack: 30 })} ctx={ctx()} />,
        );
        expect(
            screen.getByRole('button', { name: 'Resin, 30' }),
        ).toHaveAttribute('data-kind', 'initials');
    });
    it('prefab not in the catalogue → its id on a neutral tile', () => {
        const { container } = renderWithProviders(
            <ItemTile item={stack('ModdedAxe')} ctx={ctx()} />,
        );
        expect(
            screen.getByRole('button', { name: 'ModdedAxe' }),
        ).toHaveAttribute('data-kind', 'unknown');
        expect(
            container.querySelector('[data-face="prefab"]')?.textContent,
        ).toBe('ModdedAxe');
    });
});

describe('ItemTile faces — D7 ladder (cont.)', () => {
    it('file icon → <img alt> from the authorised object URL; a load error swaps to initials', async () => {
        server.use(valheimBlobHandler());
        const { container } = renderWithProviders(
            <ItemTile item={stack('TrophyBoar')} ctx={ctx()} />,
        );
        const img = await screen.findByRole('img', { name: 'Boar trophy' });
        expect(img).toHaveAttribute('src', 'blob:file-icon');
        fireEvent.error(img);
        expect(screen.queryByRole('img')).toBeNull();
        expect(
            container.querySelector('[data-face="initials"]')?.textContent,
        ).toBe('BT');
    });
    it('a missing file blob leaves the initials tile', async () => {
        server.use(valheimBlobHandler([VALHEIM_FILE_ICON_SHA]));
        const { container } = renderWithProviders(
            <ItemTile item={stack('TrophyBoar')} ctx={ctx()} />,
        );
        await waitFor(() =>
            expect(
                container.querySelector('[data-face="initials"]'),
            ).not.toBeNull(),
        );
        expect(screen.queryByRole('img')).toBeNull();
    });
    it('shows quality pips, a durability meter and the equipped marker', () => {
        renderWithProviders(
            <ItemTile
                item={stack('SwordIron', {
                    quality: 3,
                    durability: 40,
                    maxDurability: 200,
                })}
                ctx={ctx()}
                equipped
            />,
        );
        const tile = screen.getByRole('button', {
            name: 'Iron sword, quality 3, durability 20%, equipped',
        });
        expect(
            within(tile).getByTestId('valheim-quality-pips').children,
        ).toHaveLength(3);
        expect(
            within(tile).getByTestId('valheim-equipped-marker'),
        ).toBeInTheDocument();
        expect(tile.querySelector('[role="meter"]')).toHaveAttribute(
            'aria-valuenow',
            '20',
        );
    });
});

describe('ItemTile detail — D11', () => {
    it('phone: opens a BottomSheet with the wiki link (new tab, noopener, encoded name)', async () => {
        renderWithProviders(
            <ItemTile
                item={stack('SwordIron', {
                    durability: 40,
                    maxDurability: 200,
                })}
                ctx={ctx()}
            />,
        );
        fireEvent.click(
            screen.getByRole('button', { name: 'Iron sword, durability 20%' }),
        );
        const link = await screen.findByRole('link', {
            name: /open on the valheim wiki/i,
        });
        expect(link).toHaveAttribute(
            'href',
            'https://valheim.weirdgloop.org/w/Iron_sword',
        );
        expect(link).toHaveAttribute('target', '_blank');
        expect(link.getAttribute('rel')).toMatch(/noopener/);
        expect(screen.getByText('40 / 200')).toBeInTheDocument();
        expect(screen.queryByTestId('valheim-item-popover')).toBeNull();
    });
    it('desktop: opens an anchored popover dialog; Escape closes it', async () => {
        media.desktop = true;
        renderWithProviders(
            <ItemTile item={stack('SwordIron')} ctx={ctx()} equipped />,
        );
        fireEvent.click(
            screen.getByRole('button', { name: 'Iron sword, equipped' }),
        );
        const pop = await screen.findByTestId('valheim-item-popover');
        expect(pop).toHaveAttribute('role', 'dialog');
        expect(within(pop).getByText('Equipped')).toBeInTheDocument();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByTestId('valheim-item-popover')).toBeNull();
    });
    it('an unknown prefab gets no wiki link, only the catalogue note', async () => {
        media.desktop = true;
        renderWithProviders(<ItemTile item={stack('ModdedAxe')} ctx={ctx()} />);
        fireEvent.click(screen.getByRole('button', { name: 'ModdedAxe' }));
        const pop = await screen.findByTestId('valheim-item-popover');
        expect(within(pop).queryByRole('link')).toBeNull();
        expect(
            within(pop).getByText(/isn't in the server's item catalogue/),
        ).toBeInTheDocument();
    });
});

describe('ItemTile — review fixes', () => {
    it('caps the quality pips at five and shows the number above that', () => {
        renderWithProviders(
            <ItemTile item={stack('SwordIron', { quality: 10 })} ctx={ctx()} />,
        );
        const pips = screen.getByTestId('valheim-quality-pips');
        expect(pips.querySelectorAll('i').length).toBeLessThanOrEqual(5);
        expect(pips).toHaveTextContent('×10');
    });
    it('desktop popover near the right / bottom edge is clamped inside the viewport', async () => {
        media.desktop = true;
        Object.assign(window, { innerWidth: 1280, innerHeight: 800 });
        vi.spyOn(
            HTMLElement.prototype,
            'getBoundingClientRect',
        ).mockImplementation(function (this: HTMLElement) {
            const pop = this.dataset['testid'] === 'valheim-item-popover';
            const left = pop ? parseFloat(this.style.left) || 0 : 1250;
            const top = pop ? parseFloat(this.style.top) || 0 : 700;
            return DOMRect.fromRect({ x: left, y: top, width: 44, height: 44 });
        });
        renderWithProviders(<ItemTile item={stack('SwordIron')} ctx={ctx()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Iron sword' }));
        const pop = await screen.findByTestId('valheim-item-popover');
        await waitFor(() => expect(pop.style.left).toBe('984px'));
        expect(parseFloat(pop.style.top)).toBeLessThan(700);
    });

    it('first desktop position is the clamped anchor position, not offset by the unpositioned static spot', async () => {
        media.desktop = true;
        Object.assign(window, { innerWidth: 1280, innerHeight: 800 });
        vi.spyOn(
            HTMLElement.prototype,
            'getBoundingClientRect',
        ).mockImplementation(function (this: HTMLElement) {
            if (this.dataset['testid'] !== 'valheim-item-popover')
                return DOMRect.fromRect({
                    x: 1250,
                    y: 700,
                    width: 44,
                    height: 44,
                });
            // An unpositioned `fixed` box sits at its static spot (after the app root).
            const top =
                this.style.top === '' ? 900 : parseFloat(this.style.top);
            const left =
                this.style.left === '' ? 0 : parseFloat(this.style.left);
            return DOMRect.fromRect({
                x: left,
                y: top,
                width: 288,
                height: 240,
            });
        });
        renderWithProviders(<ItemTile item={stack('SwordIron')} ctx={ctx()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Iron sword' }));
        const pop = await screen.findByTestId('valheim-item-popover');
        // clampPopover: shift left to 1280 - 8 - 288, flip above to 700 - 4 - 240.
        expect(pop.style.left).toBe('984px');
        expect(pop.style.top).toBe('456px');
    });
});

describe('ItemTile detail — keyboard / screen-reader fixes', () => {
    it('phone: a closed item sheet exposes no Close button or wiki link', () => {
        renderWithProviders(<ItemTile item={stack('SwordIron')} ctx={ctx()} />);
        expect(screen.queryByRole('button', { name: /close/i })).toBeNull();
        expect(
            screen.queryByRole('link', { name: /open on the valheim wiki/i }),
        ).toBeNull();
    });
    it('desktop: focus moves into the popover once it is visible', async () => {
        media.desktop = true;
        const realFocus = HTMLElement.prototype.focus;
        // A browser refuses to focus a `visibility: hidden` element.
        vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (
            this: HTMLElement,
            opts?: FocusOptions,
        ) {
            if (this.style.visibility === 'hidden') return;
            realFocus.call(this, opts);
        });
        renderWithProviders(<ItemTile item={stack('SwordIron')} ctx={ctx()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Iron sword' }));
        const pop = await screen.findByTestId('valheim-item-popover');
        await waitFor(() => expect(document.activeElement).toBe(pop));
    });
});

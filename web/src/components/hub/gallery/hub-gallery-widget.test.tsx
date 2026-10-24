/** ROK-1942 — the hub Overview Gallery card: strip size, kind chips, empty states, See all (N), the dialog seam. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { GuildPage, HubMediaItem } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { createTestQueryClient, renderWithProviders } from '../../../test/render-helpers';
import { hubMediaFileHandler, hubMediaItem, hubMediaListHandler } from '../../../test/mocks/hub-media-handlers';
import type { HubWidgetCtx } from '../../../plugins/hub-game-widgets';
import HubGalleryWidget, { GALLERY_EDITOR_EMPTY_HINT } from './hub-gallery-widget';
import { HubGallerySeeAll } from './hub-gallery-see-all';
import { useHubGalleryStore } from './hub-gallery-store';
import { hubGalleryTileLabel } from './hub-gallery-labels';
import { useGalleryWidgetVisible } from './use-hub-gallery-visible';
import { hubMediaStripQuery } from '../../../lib/hub-media-query';

function ctx(canEdit = false): HubWidgetCtx {
    const page = {
        guild: { id: 5, kind: 'game_server', gameSlug: 'valheim' },
        viewer: { role: canEdit ? 'officer' : 'member', canEdit, canManageEditors: false },
    } as GuildPage;
    // The card reads only `page.guild.id` and `page.viewer` (register.test idiom).
    return { page, gameSlug: 'valheim' } as HubWidgetCtx;
}

const Card = ({ canEdit = false }: { canEdit?: boolean }): JSX.Element => (
    <><HubGallerySeeAll {...ctx(canEdit)} /><HubGalleryWidget {...ctx(canEdit)} /></>
);
const tiles = (): HTMLElement[] => screen.queryAllByTestId('hub-gallery-tile');
const MIXED: HubMediaItem[] = Array.from({ length: 12 }, (_, i) =>
    hubMediaItem(i + 1, i % 3 === 0 ? 'death' : i % 3 === 1 ? 'screenshot' : 'image'));

const realMatchMedia = window.matchMedia;
function setDesktop(desktop: boolean): void {
    window.matchMedia = ((query: string) => ({
        ...realMatchMedia(query), matches: query.includes('1024px') ? desktop : false,
    })) as typeof window.matchMedia;
}

function probe(canEdit: boolean) {
    const client = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    return renderHook(() => useGalleryWidgetVisible(ctx(canEdit)), { wrapper });
}

beforeEach(() => {
    useHubGalleryStore.setState({ filters: {}, request: null });
    server.use(hubMediaFileHandler);
    setDesktop(true);
});
afterEach(() => { window.matchMedia = realMatchMedia; });

describe('HubGalleryWidget — strip', () => {
    it('shows 8 tiles at ≥1024px and 6 below, newest first', async () => {
        server.use(hubMediaListHandler(MIXED));
        const { unmount } = renderWithProviders(<Card />);
        await waitFor(() => expect(tiles()).toHaveLength(8));
        expect(tiles()[0]?.getAttribute('aria-label')).toMatch(/^Death — Player1, 1 h ago\. Open picture$/);
        unmount();
        setDesktop(false);
        renderWithProviders(<Card />);
        await waitFor(() => expect(tiles()).toHaveLength(6));
    });

    it('names a tile for screen readers: kind, author, age; marks hidden for editors', () => {
        const now = Date.parse('2026-10-24T12:00:00Z');
        const item = hubMediaItem(9, 'image', { authorName: null, capturedAt: '2026-10-24T09:00:00Z', hidden: true });
        expect(hubGalleryTileLabel(item, now)).toBe('Picture (hidden), 3 h ago. Open picture');
    });
});

describe('HubGalleryWidget — kind chips', () => {
    it('Deaths narrows the strip to death posts; Screenshots to screenshots + pictures; All restores it', async () => {
        server.use(hubMediaListHandler(MIXED));
        renderWithProviders(<Card />);
        const deaths = await screen.findByRole('button', { name: 'Deaths' });
        expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(deaths);
        await waitFor(() => expect(tiles().map((t) => t.dataset.kind)).toEqual(['death', 'death', 'death', 'death']));
        expect(deaths.getAttribute('aria-pressed')).toBe('true');
        expect(await screen.findByRole('button', { name: 'See all (4)' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Screenshots' }));
        await waitFor(() => expect(new Set(tiles().map((t) => t.dataset.kind))).toEqual(new Set(['screenshot', 'image'])));
        expect(tiles()).toHaveLength(8);
        fireEvent.click(screen.getByRole('button', { name: 'All' }));
        await waitFor(() => expect(tiles()[0]?.dataset.kind).toBe('death'));
        expect(await screen.findByRole('button', { name: 'See all (12)' })).toBeTruthy();
    });

    it('draws no chips when the hub has one kind of picture', async () => {
        server.use(hubMediaListHandler([hubMediaItem(1, 'death'), hubMediaItem(2, 'death')]));
        renderWithProviders(<Card />);
        await waitFor(() => expect(tiles()).toHaveLength(2));
        expect(screen.queryByRole('group', { name: 'Show pictures' })).toBeNull();
    });
});

describe('HubGalleryWidget — empty hub (D12)', () => {
    it('a member gets no card: the body renders nothing and the probe is false', async () => {
        server.use(hubMediaListHandler([]));
        // Settled shares the card's query client, so it reports once the empty response has landed.
        function Settled(): JSX.Element | null {
            const { isSuccess } = useQuery(hubMediaStripQuery(5, 'all'));
            const visible = useGalleryWidgetVisible(ctx(false));
            return isSuccess ? <span data-testid="settled" data-visible={String(visible)} /> : null;
        }
        renderWithProviders(<><Settled /><div data-testid="card"><Card /></div></>);
        expect((await screen.findByTestId('settled')).dataset.visible).toBe('false');
        expect(screen.getByTestId('card').textContent).toBe('');
    });

    it('an editor keeps the card with the one-line hint and no See all', async () => {
        server.use(hubMediaListHandler([]));
        const { result } = probe(true);
        renderWithProviders(<Card canEdit />);
        expect((await screen.findByTestId('hub-gallery-empty')).textContent).toBe(GALLERY_EDITOR_EMPTY_HINT);
        await waitFor(() => expect(result.current).toBe(true));
        expect(screen.queryByTestId('hub-gallery-see-all')).toBeNull();
    });

    it('a visitor-style 404 hides the card for everyone', async () => {
        server.use(hubMediaListHandler(MIXED, 404));
        const { result } = probe(true);
        await waitFor(() => expect(result.current).toBe(false));
    });
});

describe('HubGalleryWidget — dialog seam (L4)', () => {
    it('See all (N) asks for the grid under the current filter; a tile asks for the viewer at its index', async () => {
        server.use(hubMediaListHandler(MIXED));
        renderWithProviders(<Card />);
        fireEvent.click(await screen.findByRole('button', { name: 'See all (12)' }));
        expect(useHubGalleryStore.getState().request).toMatchObject({ guildId: 5, mode: 'grid', filter: 'all', index: 0 });
        await waitFor(() => expect(tiles()).toHaveLength(8));
        const third = tiles()[2];
        fireEvent.click(third as HTMLElement);
        const req = useHubGalleryStore.getState().request;
        expect(req).toMatchObject({ guildId: 5, mode: 'viewer', filter: 'all', index: 2 });
        expect(req?.returnFocus).toBe(third);
    });
});

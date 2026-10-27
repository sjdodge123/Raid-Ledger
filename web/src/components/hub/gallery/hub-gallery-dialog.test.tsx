/** ROK-1942 — the Gallery dialog: viewer keys + buttons over the filtered set, focus return, chips, See-all paging, role-gated actions. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { JSX } from 'react';
import { http, HttpResponse } from 'msw';
import { HUB_MEDIA_KINDS, type HubMediaItem, type HubMediaListResponse } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { HUB_MEDIA_LIST_URL, hubMediaFileHandler, hubMediaItem } from '../../../test/mocks/hub-media-handlers';
import { HubGalleryDialog } from './hub-gallery-dialog';
import { type HubGalleryOpenRequest, useHubGalleryStore } from './hub-gallery-store';

/** 30 items: death every 3rd (ids 1, 4, 7, …), else screenshot / image. Paged by offset cursors. */
const ITEMS: HubMediaItem[] = Array.from({ length: 30 }, (_, i) =>
    hubMediaItem(i + 1, i % 3 === 0 ? 'death' : i % 3 === 1 ? 'screenshot' : 'image'));

function pagedHandler(items: HubMediaItem[], calls: string[] = []) {
    return http.get(HUB_MEDIA_LIST_URL, ({ request }) => {
        const url = new URL(request.url);
        calls.push(url.search);
        const kind = url.searchParams.get('kind');
        const matching = items.filter((i) => kind === null || i.kind === kind || (kind === 'screenshot' && i.kind === 'image'));
        const limit = Number(url.searchParams.get('limit'));
        const offset = Number(url.searchParams.get('cursor') ?? '0');
        const end = offset + limit;
        const body: HubMediaListResponse = {
            items: matching.slice(offset, end), nextCursor: end < matching.length ? String(end) : null,
            total: matching.length, kinds: HUB_MEDIA_KINDS.filter((k) => items.some((i) => i.kind === k)),
        };
        return HttpResponse.json(body);
    });
}

const triggers: HTMLElement[] = [];
const realMatchMedia = window.matchMedia;
function setDesktop(desktop: boolean): void {
    window.matchMedia = ((query: string) => ({
        ...realMatchMedia(query), matches: query.includes('1024px') ? desktop : false,
    })) as typeof window.matchMedia;
}

function Harness({ canEdit = false, canRemove = false }: { canEdit?: boolean; canRemove?: boolean }): JSX.Element | null {
    const request = useHubGalleryStore((s) => s.request);
    return request === null ? null : <HubGalleryDialog request={request} canEdit={canEdit} canRemove={canRemove} />;
}

function open(over: Partial<HubGalleryOpenRequest> = {}, roles: { canEdit?: boolean; canRemove?: boolean } = {}) {
    const trigger = document.createElement('button');
    trigger.textContent = 'tile';
    document.body.appendChild(trigger);
    triggers.push(trigger);
    useHubGalleryStore.setState({
        filters: {}, request: { guildId: 5, mode: 'viewer', filter: 'all', index: 0, returnFocus: trigger, ...over },
    });
    renderWithProviders(<Harness {...roles} />);
    return trigger;
}

const dialog = (): HTMLElement => screen.getByRole('dialog');
const caption = async (): Promise<string> => (await screen.findByTestId('hub-gallery-caption')).textContent ?? '';
const who = (n: number): RegExp => new RegExp(`Player${n}(?!\\d)`);
const counter = (): string => screen.getByTestId('hub-gallery-viewer').querySelector('[aria-live]')?.textContent ?? '';

beforeEach(() => { server.use(hubMediaFileHandler, pagedHandler(ITEMS)); setDesktop(true); });
afterEach(() => { window.matchMedia = realMatchMedia; triggers.splice(0).forEach((t) => t.remove()); });

describe('HubGalleryDialog — viewer', () => {
    it('opens at the requested index; → / ← and the buttons move; "n of N"', async () => {
        open({ index: 2 });
        expect(await caption()).toMatch(who(3));
        expect(counter()).toBe('3 of 30');
        fireEvent.keyDown(dialog(), { key: 'ArrowRight' });
        expect(await caption()).toMatch(who(4));
        fireEvent.keyDown(dialog(), { key: 'ArrowLeft' });
        fireEvent.keyDown(dialog(), { key: 'ArrowLeft' });
        expect(await caption()).toMatch(who(2));
        fireEvent.click(screen.getByRole('button', { name: 'Next picture' }));
        expect(await caption()).toMatch(who(3));
        fireEvent.click(screen.getByRole('button', { name: 'Previous picture' }));
        fireEvent.click(screen.getByRole('button', { name: 'Previous picture' }));
        expect(counter()).toBe('1 of 30');
        expect(screen.getByRole('button', { name: 'Previous picture' })).toHaveAttribute('aria-disabled', 'true');
    });

    it('a ←/→ aimed at the page behind the dialog does nothing', async () => {
        open({ index: 2 });
        expect(await caption()).toMatch(who(3));
        fireEvent.keyDown(document.body, { key: 'ArrowRight' });
        fireEvent.keyDown(document, { key: 'ArrowRight' });
        expect(counter()).toBe('3 of 30');
    });

    it('reaching an end keeps focus on the (aria-disabled, still focusable) Prev button', async () => {
        open({ index: 1 });
        expect(await caption()).toMatch(who(2));
        const prev = screen.getByRole('button', { name: 'Previous picture' });
        prev.focus();
        fireEvent.click(prev);
        expect(counter()).toBe('1 of 30');
        expect(prev).not.toBeDisabled();
        expect(prev).toHaveAttribute('aria-disabled', 'true');
        expect(document.activeElement).toBe(prev);
        fireEvent.click(prev);
        expect(counter()).toBe('1 of 30');
    });

    it('the picture sits on the media-well token (dark in every scheme), never the page backdrop', async () => {
        open({ index: 0 });
        expect(await caption()).toMatch(who(1));
        const stage = screen.getByTestId('hub-gallery-stage');
        expect(stage).toHaveClass('bg-media-well');
        expect(stage).not.toHaveClass('bg-backdrop');
    });

    it('Prev / Next walk only the filtered set (Deaths), paging past the loaded end', async () => {
        open({ filter: 'death', index: 0 });
        expect(await caption()).toMatch(who(1));
        expect(counter()).toBe('1 of 10');
        fireEvent.keyDown(dialog(), { key: 'ArrowRight' });
        expect(await caption()).toMatch(who(4));
        expect(await caption()).toMatch(/^Death/);
    });

    it('Next pages in the next cursor page at the end of the loaded list', async () => {
        open({ index: 23 });
        expect(await caption()).toMatch(who(24));
        fireEvent.click(screen.getByRole('button', { name: 'Next picture' }));
        await waitFor(() => expect(counter()).toBe('25 of 30'));
        expect(await caption()).toMatch(who(25));
    });

    it('a dialog chip narrows the set, restarts at its first picture and syncs the card filter', async () => {
        open({ index: 1 });
        expect(await caption()).toMatch(who(2));
        fireEvent.click(screen.getByTestId('hub-gallery-chip-death'));
        await waitFor(() => expect(counter()).toBe('1 of 10'));
        expect(await caption()).toMatch(who(1));
        expect(useHubGalleryStore.getState().filters[5]).toBe('death');
    });

    it('opens the clicked picture by id even when the list moved since the strip fetched it', async () => {
        server.use(pagedHandler([hubMediaItem(31, 'screenshot'), ...ITEMS]));
        open({ index: 2, mediaId: 3 });
        expect(await caption()).toMatch(who(3));
        fireEvent.keyDown(dialog(), { key: 'ArrowRight' });
        expect(await caption()).toMatch(who(4));
    });

    it('opens a picture beyond the first loaded page: pages in until its id is loaded, never showing another one first', async () => {
        open({ index: 0, mediaId: 28 });
        expect(await caption()).toMatch(who(28));
        expect(counter()).toBe('28 of 30');
    });

    it('an id in no page falls back to the requested index once every page is loaded', async () => {
        const calls: string[] = [];
        server.use(pagedHandler(ITEMS, calls));
        open({ index: 2, mediaId: 999 });
        expect(await caption()).toMatch(who(3));
        expect(calls).toHaveLength(2);
    });

    it('removing the last picture of the selected kind falls the dialog filter back to All', async () => {
        const items = [hubMediaItem(1, 'death'), hubMediaItem(2, 'screenshot')];
        server.use(pagedHandler(items), http.delete('http://localhost:3000/hubs/:guildId/media/:id', ({ params }) => {
            items.splice(items.findIndex((i) => String(i.id) === params.id), 1);
            return new HttpResponse(null, { status: 204 });
        }));
        open({ filter: 'death', index: 0 }, { canRemove: true });
        expect(await caption()).toMatch(who(1));
        fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
        fireEvent.click(screen.getByRole('button', { name: 'Remove for good' }));
        await waitFor(() => expect(useHubGalleryStore.getState().filters[5]).toBe('all'));
        expect(await caption()).toMatch(who(2));
        expect(screen.queryByTestId('hub-gallery-chip-death')).toBeNull();
    });

    it('Escape closes and returns focus to the tile that opened it', async () => {
        const trigger = open();
        await caption();
        fireEvent.keyDown(document, { key: 'Escape' });
        await waitFor(() => expect(useHubGalleryStore.getState().request).toBeNull());
        await waitFor(() => expect(document.activeElement).toBe(trigger));
    });

    it('× closes and returns focus too', async () => {
        const trigger = open();
        await caption();
        fireEvent.click(screen.getByRole('button', { name: /close/i }));
        await waitFor(() => expect(document.activeElement).toBe(trigger));
    });
});

describe('HubGalleryDialog — roles', () => {
    it('a member gets no Hide or Remove', async () => {
        open();
        await caption();
        expect(screen.queryByRole('button', { name: 'Hide' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Back to all' })).toBeInTheDocument();
    });

    it('an editor gets Hide (PATCH {hidden:true}) but not Remove; a hidden item offers Unhide', async () => {
        const bodies: unknown[] = [];
        server.use(http.patch('http://localhost:3000/hubs/:guildId/media/:id', async ({ request, params }) => {
            bodies.push({ id: params.id, body: await request.json() });
            return HttpResponse.json({ ...hubMediaItem(1, 'death'), hidden: true });
        }));
        open({}, { canEdit: true });
        await caption();
        expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
        await waitFor(() => expect(bodies).toEqual([{ id: '1', body: { hidden: true } }]));
    });

    it('an editor sees Unhide on a hidden picture', async () => {
        server.use(pagedHandler([hubMediaItem(1, 'death', { hidden: true })]));
        open({}, { canEdit: true });
        await caption();
        expect(screen.getByRole('button', { name: 'Unhide' })).toBeInTheDocument();
    });

    it('staff Remove asks inline, then DELETEs', async () => {
        const deleted: string[] = [];
        server.use(http.delete('http://localhost:3000/hubs/:guildId/media/:id', ({ params }) => {
            deleted.push(String(params.id));
            return new HttpResponse(null, { status: 204 });
        }));
        open({}, { canRemove: true });
        await caption();
        expect(screen.queryByRole('button', { name: 'Hide' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
        expect(deleted).toEqual([]);
        fireEvent.click(screen.getByRole('button', { name: 'Remove for good' }));
        await waitFor(() => expect(deleted).toEqual(['1']));
    });
});

describe('HubGalleryDialog — See all grid', () => {
    it('shows the first page, Load more follows nextCursor, a tile opens the viewer at its index', async () => {
        const calls: string[] = [];
        server.use(pagedHandler(ITEMS, calls));
        open({ mode: 'grid' });
        await waitFor(() => expect(screen.getAllByTestId('hub-gallery-tile')).toHaveLength(24));
        expect(screen.getByText('30 pictures')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
        await waitFor(() => expect(screen.getAllByTestId('hub-gallery-tile')).toHaveLength(30));
        expect(calls.at(-1)).toContain('cursor=24');
        expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
        const tile = screen.getAllByTestId('hub-gallery-tile')[26];
        if (tile === undefined) throw new Error('tile 27 missing');
        await act(async () => { fireEvent.click(tile); });
        expect(await caption()).toMatch(who(27));
        fireEvent.click(screen.getByRole('button', { name: 'Back to all' }));
        await waitFor(() => expect(screen.getByTestId('hub-gallery-grid')).toBeInTheDocument());
    });

    it('the grid chips narrow it (Screenshots = screenshot + image)', async () => {
        open({ mode: 'grid' });
        await waitFor(() => expect(screen.getAllByTestId('hub-gallery-tile')).toHaveLength(24));
        fireEvent.click(screen.getByTestId('hub-gallery-chip-screenshot'));
        await waitFor(() => expect(screen.getByText('20 pictures')).toBeInTheDocument());
        expect(screen.getAllByTestId('hub-gallery-tile').every((t) => t.dataset.kind !== 'death')).toBe(true);
    });

    it('renders as a BottomSheet below 1024px with the same viewer', async () => {
        setDesktop(false);
        open({ index: 0 });
        expect(await caption()).toMatch(who(1));
        expect(screen.getByRole('button', { name: 'Next picture' })).toBeInTheDocument();
    });
});

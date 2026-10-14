/**
 * Pelican admin — Servers section (ROK-1094). Drives the real section, hooks
 * and table against MSW; assertions are about the PATCH body that left the
 * page, the toast the outcome produced, and which layout rendered.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { PelicanServerRowDto, PelicanServerUpdate, PelicanSyncResult } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    PELICAN_SERVERS_URL, PELICAN_SERVER_URL, PELICAN_SYNC_URL, pelicanServerFixture, pelicanSyncOkResult,
} from '../../../test/mocks/pelican-handlers';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { toast } from '../../../lib/toast';
import { PelicanServersSection } from './pelican-servers-section';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    getAuthToken: vi.fn(() => 'test-token'),
}));
vi.mock('../../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const originalMatchMedia = window.matchMedia;

function setViewport(desktop: boolean): void {
    window.matchMedia = (query: string) => ({
        matches: query === DESKTOP_MQ ? desktop : false, media: query, onchange: null,
        addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {},
        dispatchEvent: () => false,
    });
}

const suspended: PelicanServerRowDto = {
    ...pelicanServerFixture, id: 2, name: 'Rust — Old', state: 'offline', isSuspended: true,
    gameId: null, gameName: null, showOnCalendar: false, timezone: 'Europe/Berlin', lastSyncedAt: null, missing: true,
};

interface ServeOpts { failPatch?: boolean; hold?: Promise<void>; registry?: { id: number; name: string; coverUrl: null }[] }

/** Serves the list and records every PATCH body; `failPatch` answers 500; `hold` delays the PATCH reply. */
function serveServers(rows: PelicanServerRowDto[], { failPatch = false, hold, registry = [] }: ServeOpts = {}): PelicanServerUpdate[] {
    const patches: PelicanServerUpdate[] = [];
    server.use(
        http.get('http://localhost:3000/games/configured', () => HttpResponse.json({ data: registry, meta: { total: registry.length } })),
        http.get(PELICAN_SERVERS_URL, () => HttpResponse.json({ data: rows })),
        http.patch(PELICAN_SERVER_URL, async ({ request, params }) => {
            const body = (await request.json()) as PelicanServerUpdate;
            patches.push(body);
            if (hold) await hold;
            if (failPatch) return HttpResponse.json({ message: 'Panel said no' }, { status: 500 });
            const row = rows.find((r) => r.id === Number(params.id)) ?? pelicanServerFixture;
            return HttpResponse.json({ ...row, ...body });
        }),
    );
    return patches;
}

async function renderSection(rows: PelicanServerRowDto[], opts: ServeOpts = {}) {
    const patches = serveServers(rows, opts);
    renderWithProviders(<PelicanServersSection defaultTimezone="America/New_York" />);
    const [first] = rows;
    if (first) await screen.findByText(first.name);
    return patches;
}

beforeEach(() => { vi.clearAllMocks(); setViewport(true); });
afterEach(() => { window.matchMedia = originalMatchMedia; });

describe('PelicanServersSection — layout', () => {
    it('empty list: the §4.5 empty state with the next step', async () => {
        await renderSection([]);
        expect(await screen.findByText('No servers yet. Save the connection, then Sync now.')).toBeInTheDocument();
        expect(screen.queryByTestId('pelican-servers-table')).toBeNull();
    });

    it('≥1024px: a table with one row per server, chips and the missing note', async () => {
        await renderSection([pelicanServerFixture, suspended]);
        const table = screen.getByTestId('pelican-servers-table');
        expect(within(table).getAllByRole('row')).toHaveLength(3);
        expect(within(screen.getByTestId('pelican-server-row-1')).getByText('Running')).toHaveAttribute('data-tone', 'success');
        expect(within(screen.getByTestId('pelican-server-row-2')).getByText('Suspended')).toHaveAttribute('data-tone', 'danger');
        expect(within(screen.getByTestId('pelican-server-row-2')).getByText('Missing from panel')).toBeInTheDocument();
        expect(screen.queryByTestId('pelican-servers-cards')).toBeNull();
    });

    it('<1024px: one stacked card per server and no table', async () => {
        setViewport(false);
        await renderSection([pelicanServerFixture, suspended]);
        expect(screen.getByTestId('pelican-server-card-1')).toBeInTheDocument();
        expect(screen.getByTestId('pelican-server-card-2')).toBeInTheDocument();
        expect(screen.queryByTestId('pelican-servers-table')).toBeNull();
    });

    it('≥1024px: the column header is the label — per-row Game/Timezone labels are sr-only, controls stay named', async () => {
        await renderSection([pelicanServerFixture]);
        const row = within(screen.getByTestId('pelican-server-row-1'));
        for (const name of ['Game', 'Timezone']) {
            expect(row.getByText(name, { selector: 'label' })).toHaveClass('sr-only');
            expect(row.getByRole('combobox', { name })).toBeInTheDocument();
        }
    });

    it('≥1024px: a mapped row shows its game name once (in the picker, no repeat under it)', async () => {
        await renderSection([pelicanServerFixture]);
        const row = within(screen.getByTestId('pelican-server-row-1'));
        expect(row.getByRole('combobox', { name: 'Game' })).toHaveValue('Valheim');
        expect(row.queryAllByText('Valheim')).toHaveLength(0);
    });

    it('<1024px: cards keep the visible Game/Timezone labels', async () => {
        setViewport(false);
        await renderSection([pelicanServerFixture]);
        const card = within(screen.getByTestId('pelican-server-card-1'));
        for (const name of ['Game', 'Timezone']) {
            expect(card.getByText(name, { selector: 'label' })).not.toHaveClass('sr-only');
        }
    });
});

describe('PelicanServersSection — row edits', () => {
    it('Show on calendar applies at once and PATCHes only that field', async () => {
        let release = () => {};
        const hold = new Promise<void>((resolve) => { release = resolve; });
        const patches = await renderSection([pelicanServerFixture], { hold });
        const sw = screen.getByTestId('pelican-server-1-calendar');
        fireEvent.click(sw);
        // The PATCH reply is held, so a flipped switch here is the optimistic write.
        await waitFor(() => expect(patches).toEqual([{ showOnCalendar: false }]));
        expect(sw).toHaveAttribute('aria-checked', 'false');
        release();
    });

    it('a failed PATCH rolls the switch back and toasts the error', async () => {
        await renderSection([pelicanServerFixture], { failPatch: true });
        const sw = screen.getByTestId('pelican-server-1-calendar');
        fireEvent.click(sw);
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Panel said no'));
        expect(sw).toHaveAttribute('aria-checked', 'true');
    });

    it("Use default PATCHes only timezone: ''", async () => {
        const patches = await renderSection([suspended]);
        fireEvent.click(screen.getByRole('button', { name: 'Use default' }));
        await waitFor(() => expect(patches).toEqual([{ timezone: '' }]));
    });

    it('clearing the game PATCHes only gameId: null', async () => {
        const patches = await renderSection([pelicanServerFixture]);
        fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
        await waitFor(() => expect(patches).toEqual([{ gameId: null }]));
    });

    it('a failed PATCH rolls back only its own row, and every failure toasts', async () => {
        let release = () => {};
        const hold = new Promise<void>((resolve) => { release = resolve; });
        const second: PelicanServerRowDto = { ...pelicanServerFixture, id: 3, name: 'Palworld' };
        await renderSection([pelicanServerFixture, second]);
        server.use(http.patch(PELICAN_SERVER_URL, async ({ params }) => {
            if (params.id === '1') { await hold; return HttpResponse.json({ message: 'Panel said no' }, { status: 500 }); }
            return HttpResponse.json({ ...second, name: 'Palworld (saved)', showOnCalendar: false });
        }));
        fireEvent.click(screen.getByTestId('pelican-server-1-calendar'));
        fireEvent.click(screen.getByTestId('pelican-server-3-calendar'));
        // Row 3's PATCH has saved (its reply is in the cache) before row 1's fails.
        await screen.findByText('Palworld (saved)');
        release();
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Panel said no'));
        expect(screen.getByTestId('pelican-server-1-calendar')).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByTestId('pelican-server-3-calendar')).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByText('Palworld (saved)')).toBeInTheDocument();
    });
});

describe('PelicanServersSection — game picker (review MAJOR)', () => {
    const gameBox = () => screen.getByRole('combobox', { name: 'Game' });

    it('typing over the game sends no PATCH, and leaving without a pick puts the game back', async () => {
        const patches = await renderSection([pelicanServerFixture]);
        await userEvent.type(gameBox(), 'ab');
        await userEvent.click(screen.getByTestId('pelican-server-1-calendar'));
        await waitFor(() => expect(patches).toContainEqual({ showOnCalendar: false }));
        expect(patches).toEqual([{ showOnCalendar: false }]);
        expect(gameBox()).toHaveValue('Valheim');
    });

    it('picking a replacement game PATCHes only that gameId', async () => {
        const patches = await renderSection([pelicanServerFixture], { registry: [{ id: 42, name: 'Hades', coverUrl: null }] });
        await userEvent.clear(gameBox());
        await userEvent.type(gameBox(), 'H');
        await userEvent.click(await screen.findByRole('option', { name: 'Hades' }));
        await waitFor(() => expect(patches).toEqual([{ gameId: 42 }]));
    });

    it('a failed pick rolls the box back to the row\'s game and toasts the error', async () => {
        const patches = await renderSection([pelicanServerFixture], { failPatch: true, registry: [{ id: 42, name: 'Hades', coverUrl: null }] });
        await userEvent.clear(gameBox());
        await userEvent.type(gameBox(), 'H');
        await userEvent.click(await screen.findByRole('option', { name: 'Hades' }));
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Panel said no'));
        expect(patches).toEqual([{ gameId: 42 }]);
        await waitFor(() => expect(gameBox()).toHaveValue('Valheim'));
    });

    it('emptying the box and leaving it PATCHes only gameId: null', async () => {
        const patches = await renderSection([pelicanServerFixture]);
        await userEvent.clear(gameBox());
        await userEvent.click(screen.getByText('Valheim — Main'));
        await waitFor(() => expect(patches).toEqual([{ gameId: null }]));
    });
});

describe('PelicanServersSection — Sync now', () => {
    async function syncWith(result: PelicanSyncResult) {
        server.use(http.post(PELICAN_SYNC_URL, () => HttpResponse.json(result)));
        await renderSection([pelicanServerFixture]);
        fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    }

    it('ok → success toast with the counts', async () => {
        await syncWith(pelicanSyncOkResult);
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Synced 2 servers'));
    });

    it('in_progress → info toast with the server message', async () => {
        await syncWith({ ...pelicanSyncOkResult, code: 'in_progress', message: 'A sync is already running.', status: null });
        await waitFor(() => expect(toast.info).toHaveBeenCalledWith('A sync is already running.'));
    });

    it('forbidden → error toast with the server message', async () => {
        await syncWith({ ...pelicanSyncOkResult, code: 'forbidden', message: 'The key cannot list servers.', status: null });
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('The key cannot list servers.'));
    });
});

/**
 * ROK-1918 L5 — arrange mode end-to-end through the hub page: who sees
 * Arrange, reorder + announcement, hide/show, add-at-top, the saved PATCH
 * body, Reset, Cancel restoring the grid, and the dirty guard.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import type { JSX } from 'react';
import type { GuildPage as GuildPageDto, HubWidgetPrefs } from '@raid-ledger/contract';
import type { HubModule } from '../../../plugins/hub-module';
import { clearRegistry, registerPlugin } from '../../../plugins/plugin-registry';
import { usePluginStore } from '../../../stores/plugin-store';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { GuildPage } from '../hub-page';

const BASE = 'http://localhost:3000/guilds/7';
const SLUG = 'testgame';
const TEXT_CONFIG = { 'generic:text': { title: 'Note', body: 'Hi' } };

const PAGE: GuildPageDto = {
    guild: { id: 7, gameId: 1, kind: 'game_server', name: 'Longhouse', region: 'us', realmSlug: null, realmName: null, faction: null, memberCount: 2, lastSnapshotAt: null },
    importedBy: null,
    viewer: { role: 'leader', canEdit: true, canManageEditors: true },
    ranks: [],
    roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
};

const Uptime = (): JSX.Element => <p data-testid="w-uptime">Uptime</p>;
const Arrivals = (): JSX.Element => <p data-testid="w-arrivals">Arrivals</p>;
const Notes = (): JSX.Element => <p data-testid="w-notes">Notes</p>;

const testModule: HubModule = {
    kind: 'game_server',
    tabs: [],
    overviewWidgets: [
        { id: 'uptime', title: 'Uptime', order: 50, component: Uptime },
        { id: 'arrivals', title: 'Arrivals', order: 55, component: Arrivals },
        { id: 'notes', title: 'Notes', description: 'A pinned note.', order: 60, defaultOn: false, component: Notes },
    ],
    memberColumns: [],
    heroPills: [],
    memberRows: () => [],
};

let patched: unknown[] = [];

function serve(page: GuildPageDto, widgetPrefs: HubWidgetPrefs | null = null): void {
    server.use(
        http.get(BASE, () => HttpResponse.json({ ...page, widgetPrefs })),
        http.patch(`${BASE}/widget-prefs`, async ({ request }) => {
            const body = (await request.json()) as Record<string, unknown>;
            patched.push(body);
            return HttpResponse.json({ widgetPrefs: 'reset' in body ? null : body });
        }),
    );
}

async function openArrange(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
    renderWithProviders(<Routes><Route path="/hubs/:id" element={<GuildPage />} /></Routes>, { initialEntries: ['/hubs/7'] });
    const button = await screen.findByTestId('hub-arrange');
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    return screen.findByRole('list', { name: 'Overview widgets, in order' });
}

function rowIds(list: HTMLElement): string[] {
    return within(list).getAllByRole('listitem').map((li) => (li.dataset.testid ?? '').replace('arrange-row-', ''));
}

beforeEach(() => {
    patched = [];
    clearRegistry();
    registerPlugin(SLUG, { icon: '/x.png', color: 'blue', label: 'Test game' }).registerHubModule(testModule);
    usePluginStore.setState({ activeSlugs: new Set([SLUG]), initialized: true });
});

afterEach(() => {
    clearRegistry();
    usePluginStore.setState({ activeSlugs: new Set<string>(), initialized: true });
});

describe('Arrange button (ROK-1918 AC1)', () => {
    it('is not rendered for a member who cannot edit', async () => {
        serve({ ...PAGE, viewer: { role: 'member', canEdit: false, canManageEditors: false } });
        renderWithProviders(<Routes><Route path="/hubs/:id" element={<GuildPage />} /></Routes>, { initialEntries: ['/hubs/7'] });
        await screen.findByTestId('w-uptime');
        expect(screen.queryByTestId('hub-arrange')).not.toBeInTheDocument();
    });
});

describe('arrange mode — editing the list (ROK-1918 L5)', () => {
    it('moves a row up and announces its new position', async () => {
        const user = userEvent.setup();
        serve(PAGE);
        const list = await openArrange(user);
        const before = rowIds(list);
        const i = before.indexOf('module:arrivals');
        await user.click(screen.getByRole('button', { name: 'Move Arrivals up' }));
        expect(rowIds(list).indexOf('module:arrivals')).toBe(i - 1);
        expect(screen.getByTestId('arrange-live')).toHaveTextContent(`Arrivals moved to position ${i} of ${before.length}.`);
        await user.click(screen.getByRole('button', { name: 'Move Arrivals down' }));
        expect(rowIds(list)).toEqual(before);
    });

    it('hides a row in place, dimmed, and shows it again', async () => {
        const user = userEvent.setup();
        serve(PAGE);
        await openArrange(user);
        await user.click(screen.getByRole('button', { name: 'Hide Uptime' }));
        const show = screen.getByRole('button', { name: 'Show Uptime' });
        expect(show).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('arrange-row-module:uptime')).toHaveAttribute('data-hidden', 'true');
        await user.click(show);
        expect(screen.getByTestId('arrange-row-module:uptime')).not.toHaveAttribute('data-hidden');
    });

    it('adds an opt-in widget from the picker at the top of the list', async () => {
        const user = userEvent.setup();
        serve(PAGE);
        const list = await openArrange(user);
        expect(rowIds(list)).not.toContain('module:notes');
        await user.click(screen.getByTestId('arrange-add'));
        await user.click(await screen.findByRole('button', { name: 'Add Notes' }));
        expect(rowIds(list)[0]).toBe('module:notes');
    });

});

describe('arrange mode — save, reset, cancel, leave (ROK-1918 L5)', () => {
    it('saves the full order (hidden rows included) and passes config through', async () => {
        const user = userEvent.setup();
        serve(PAGE, { order: [], hidden: [], added: [], config: TEXT_CONFIG });
        const list = await openArrange(user);
        await user.click(screen.getByRole('button', { name: 'Hide Uptime' }));
        await user.click(screen.getByTestId('arrange-save'));
        await waitFor(() => expect(patched).toHaveLength(1));
        expect(patched[0]).toEqual({ order: rowIds(list), hidden: ['module:uptime'], added: [], config: TEXT_CONFIG });
        expect(await screen.findByTestId('guild-overview')).toBeInTheDocument();
    });

    it('Reset to default confirms, then sends { reset: true }', async () => {
        const user = userEvent.setup();
        serve(PAGE);
        await openArrange(user);
        await user.click(screen.getByTestId('arrange-reset'));
        await user.click(await screen.findByTestId('discard-changes-discard'));
        await waitFor(() => expect(patched).toEqual([{ reset: true }]));
    });

    it('Cancel with no changes leaves at once; with changes it asks, and Discard restores the saved order', async () => {
        const user = userEvent.setup();
        serve(PAGE);
        const list = await openArrange(user);
        const before = rowIds(list);
        await user.click(screen.getByRole('button', { name: 'Move Arrivals up' }));
        await user.click(screen.getByTestId('arrange-cancel'));
        await user.click(await screen.findByTestId('discard-changes-keep'));
        expect(screen.getByTestId('hub-arrange-mode')).toBeInTheDocument();
        await user.click(screen.getByTestId('arrange-cancel'));
        await user.click(await screen.findByTestId('discard-changes-discard'));
        await user.click(await screen.findByTestId('hub-arrange'));
        expect(rowIds(await screen.findByRole('list', { name: 'Overview widgets, in order' }))).toEqual(before);
        await user.click(screen.getByTestId('arrange-cancel'));
        expect(await screen.findByTestId('guild-overview')).toBeInTheDocument();
        expect(patched).toEqual([]);
    });

    it('asks before the page unloads while the draft is dirty', async () => {
        const user = userEvent.setup();
        serve(PAGE);
        await openArrange(user);
        const clean = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(clean);
        expect(clean.defaultPrevented).toBe(false);
        await user.click(screen.getByRole('button', { name: 'Hide Uptime' }));
        const dirty = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(dirty);
        expect(dirty.defaultPrevented).toBe(true);
    });
});

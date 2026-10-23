/**
 * ROK-1918 L5 — arrange mode end-to-end through the hub page: who sees
 * Arrange, reorder + announcement, hide/show, add-at-top, the saved PATCH
 * body, Reset, Cancel restoring the grid, and the dirty guard; Codex fix round:
 * hub switch, lost edit rights and the in-hub tab-switch guard.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes, useNavigate } from 'react-router-dom';
import type { JSX } from 'react';
import type { GuildPage as GuildPageDto, HubWidgetPrefs } from '@raid-ledger/contract';
import type { HubModule } from '../../../plugins/hub-module';
import { clearRegistry, registerPlugin } from '../../../plugins/plugin-registry';
import { usePluginStore } from '../../../stores/plugin-store';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { GUILD_RAIDS_URL } from '../../../test/mocks/guild-raids-handlers';
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

/** The default arrange order for `PAGE` + `testModule` (hidden rows keep their slot). */
const SAVED_ORDER = ['gm-post', 'discord', 'schedule', 'events', 'module:uptime', 'module:arrivals', 'attendance'];

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

function renderPage(): ReturnType<typeof renderWithProviders> {
    return renderWithProviders(<Routes><Route path="/hubs/:id" element={<GuildPage />} /></Routes>, { initialEntries: ['/hubs/7'] });
}

/** Arrange mode has closed and the grid is showing again. */
async function expectGridBack(): Promise<void> {
    await waitFor(() => expect(screen.queryByTestId('hub-arrange-mode')).not.toBeInTheDocument());
    expect(screen.getByTestId('guild-overview')).toBeVisible();
}

async function openArrange(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
    renderPage();
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

    it('stays disabled while the raids query is still loading', async () => {
        serve(PAGE);
        server.use(http.get(GUILD_RAIDS_URL, () => new Promise<never>(() => undefined)));
        renderPage();
        expect(await screen.findByTestId('hub-arrange')).toBeDisabled();
    });

    it('stays disabled when the raids query failed (its widgets are missing from the draft)', async () => {
        serve(PAGE);
        server.use(http.get(GUILD_RAIDS_URL, () => HttpResponse.json({ message: 'nope' }, { status: 403 })));
        const { queryClient } = renderPage();
        const button = await screen.findByTestId('hub-arrange');
        await waitFor(() => expect(queryClient.getQueryCache().findAll().some((q) => q.queryKey.includes('raids') && q.state.status === 'error')).toBe(true));
        expect(button, 'Arrange must not open on a draft missing the raids widgets').toBeDisabled();
    });

    it('keeps the grid\'s widgets mounted across the editor chunk loading and arrange enter/exit', async () => {
        const user = userEvent.setup();
        serve(PAGE);
        renderPage();
        const first = await screen.findByTestId('w-uptime');
        const button = await screen.findByTestId('hub-arrange');
        await waitFor(() => expect(button).toBeEnabled());
        expect(screen.getByTestId('w-uptime'), 'no remount when the editor chunk resolves').toBe(first);
        await user.click(button);
        await screen.findByTestId('hub-arrange-mode');
        expect(screen.getByTestId('guild-overview')).not.toBeVisible();
        await user.click(screen.getByTestId('arrange-cancel'));
        await expectGridBack();
        expect(screen.getByTestId('w-uptime'), 'no remount on leaving arrange mode').toBe(first);
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

    it('lays the list in a minmax(0,1fr) column so long titles truncate on phones', async () => {
        const user = userEvent.setup();
        serve(PAGE);
        const list = await openArrange(user);
        // jsdom has no layout; these classes are what keep a phone row inside the viewport (ROK-1918 e2e).
        expect(screen.getByTestId('arrange-layout').className, 'implicit auto track = rows wider than the phone').toMatch(/(^|\s)grid-cols-1(\s|$)/);
        expect(list.className, 'the <ol> must be allowed to shrink below its min-content width').toMatch(/(^|\s)min-w-0(\s|$)/);
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
        expect(patched[0]).toEqual({ order: SAVED_ORDER, hidden: ['module:uptime'], added: [], config: TEXT_CONFIG });
        expect(rowIds(list)).toEqual(SAVED_ORDER);
        await expectGridBack();
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
        await expectGridBack();
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

describe('arrange mode — Codex fix round (ROK-1918)', () => {
    function GoTo({ to }: { to: string }): JSX.Element {
        const navigate = useNavigate();
        return <button type="button" data-testid={`go-${to}`} onClick={() => navigate(to)}>{to}</button>;
    }

    it('a switch to another cached hub of the same kind leaves arrange mode; the next save goes to that hub', async () => {
        const user = userEvent.setup();
        const saves: string[] = [];
        server.use(
            http.get('http://localhost:3000/guilds/:id', ({ params }) => HttpResponse.json({ ...PAGE, guild: { ...PAGE.guild, id: Number(params.id) }, widgetPrefs: null })),
            http.patch('http://localhost:3000/guilds/:id/widget-prefs', async ({ params, request }) => {
                saves.push(String(params.id));
                return HttpResponse.json({ widgetPrefs: await request.json() });
            }),
        );
        renderWithProviders(<><GoTo to="/hubs/7" /><GoTo to="/hubs/8" /><Routes><Route path="/hubs/:id" element={<GuildPage />} /></Routes></>, { initialEntries: ['/hubs/8'] });
        await screen.findByTestId('w-uptime');
        await user.click(screen.getByTestId('go-/hubs/7'));
        const button = await screen.findByTestId('hub-arrange');
        await waitFor(() => expect(button).toBeEnabled());
        await user.click(button);
        await user.click(await screen.findByRole('button', { name: 'Hide Uptime' }));
        await user.click(screen.getByTestId('go-/hubs/8'));
        expect(screen.queryByTestId('hub-arrange-mode'), "hub 7's draft must not follow the viewer to hub 8").not.toBeInTheDocument();
        expect(screen.getByTestId('guild-overview')).toBeVisible();
        await user.click(screen.getByTestId('hub-arrange'));
        expect(screen.getByTestId('arrange-row-module:uptime'), 'hub 8 opens on a fresh draft').not.toHaveAttribute('data-hidden');
        await user.click(screen.getByRole('button', { name: 'Hide Arrivals' }));
        await user.click(screen.getByTestId('arrange-save'));
        await waitFor(() => expect(saves).toEqual(['8']));
    });

    it('losing edit rights on a refetch while arranging shows the grid again', async () => {
        const user = userEvent.setup();
        serve(PAGE);
        const { queryClient } = renderPage();
        const button = await screen.findByTestId('hub-arrange');
        await waitFor(() => expect(button).toBeEnabled());
        await user.click(button);
        await screen.findByTestId('hub-arrange-mode');
        serve({ ...PAGE, viewer: { role: 'member', canEdit: false, canManageEditors: false } });
        await queryClient.invalidateQueries();
        await waitFor(() => expect(screen.queryByTestId('hub-arrange')).not.toBeInTheDocument());
        expect(screen.getByTestId('guild-overview'), 'a demoted viewer must not be left on a hidden grid').toBeVisible();
    });
});

describe('arrange mode — in-hub tab-switch guard (ROK-1918 Codex fix round)', () => {
    afterEach(() => { window.history.replaceState(null, '', '/'); });

    it('a tab switch with an unsaved draft asks first; Keep stays, Discard switches', async () => {
        const user = userEvent.setup();
        serve(PAGE);
        await openArrange(user);
        await user.click(screen.getByRole('link', { name: 'Members' }));
        expect(window.location.hash, 'a clean draft does not block the switch').toBe('#members');
        await user.click(screen.getByRole('link', { name: 'Overview' }));
        await user.click(await screen.findByTestId('hub-arrange'));
        await user.click(await screen.findByRole('button', { name: 'Hide Uptime' }));
        await user.click(screen.getByRole('link', { name: 'Members' }));
        expect(window.location.hash, 'a dirty draft must not be dropped by a silent tab switch').toBe('#overview');
        expect(screen.getByTestId('discard-changes-keep'), 'a dirty draft asks before the switch').toBeVisible();
        await user.click(screen.getByTestId('discard-changes-keep'));
        expect(screen.getByTestId('hub-arrange-mode')).toBeInTheDocument();
        expect(window.location.hash).toBe('#overview');
        await user.click(screen.getByRole('link', { name: 'Members' }));
        await user.click(await screen.findByTestId('discard-changes-discard'));
        await waitFor(() => expect(window.location.hash).toBe('#members'));
        expect(screen.queryByTestId('hub-arrange-mode')).not.toBeInTheDocument();
    });
});

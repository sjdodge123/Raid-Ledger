/**
 * ROK-1830 AC2 — a second hub kind plugs into the shell with ZERO core edits.
 *
 * A throwaway plugin registers a `game_server` hub module with one tab and one
 * Overview widget. The core `/guilds/:id` shell must offer the tab in the
 * frame's module band (after Overview/Members, before Resources), render its
 * panel when selected, and draw the widget in the Overview bento — none of
 * which this file teaches core about.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import type { JSX } from 'react';
import type { GuildPage as GuildPageDto } from '@raid-ledger/contract';
import type { HubCtx, HubModule } from '../../plugins/hub-module';
import { clearRegistry, registerPlugin } from '../../plugins/plugin-registry';
import { usePluginStore } from '../../stores/plugin-store';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { GuildPage } from './hub-page';

const BASE = 'http://localhost:3000/plugins/wow/guilds/7';
const SLUG = 'testgame';

const PAGE: GuildPageDto = {
    guild: { id: 7, gameId: 1, kind: 'game_server', name: 'Valheim Longhouse', region: 'us', realmSlug: null, realmName: null, faction: null, memberCount: 2, lastSnapshotAt: null },
    importedBy: null,
    viewer: { role: 'member', canEdit: false, canManageEditors: false },
    ranks: [],
    roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
};

function WorldTab({ page }: HubCtx): JSX.Element {
    return <p data-testid="module-tab-panel">World of {page.guild.name}</p>;
}

function UptimeWidget(): JSX.Element {
    return <p data-testid="module-widget">Uptime 99%</p>;
}

const testModule: HubModule = {
    kind: 'game_server',
    tabs: [{ id: 'world', label: 'World', order: 10, component: WorldTab }],
    overviewWidgets: [{ id: 'uptime', order: 55, component: UptimeWidget }],
    memberColumns: [],
    heroPills: [],
    memberRows: () => [],
};

function renderPage(): void {
    renderWithProviders(<Routes><Route path="/guilds/:id" element={<GuildPage />} /></Routes>, { initialEntries: ['/guilds/7'] });
}

beforeEach(() => {
    clearRegistry();
    registerPlugin(SLUG, { icon: '/x.png', color: 'blue', label: 'Test game' }).registerHubModule(testModule);
    usePluginStore.setState({ activeSlugs: new Set([SLUG]), initialized: true });
    server.use(http.get(BASE, () => HttpResponse.json(PAGE)));
});

afterEach(() => {
    window.location.hash = '';
    clearRegistry();
    usePluginStore.setState({ activeSlugs: new Set<string>(), initialized: true });
});

describe('hub module extension point (ROK-1830 AC2)', () => {
    it('puts the module tab between the core frame tabs and renders its panel', async () => {
        renderPage();
        const nav = await screen.findByRole('navigation', { name: 'Guild page sections' });
        expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Overview', 'Members', 'Events', 'World']);

        await userEvent.click(within(nav).getByRole('link', { name: 'World' }));
        await waitFor(() => expect(screen.getByTestId('module-tab-panel')).toHaveTextContent('World of Valheim Longhouse'));
        expect(screen.getByRole('region', { name: 'World' })).toBeInTheDocument();
    });

    it('draws the module widget in the core Overview bento', async () => {
        renderPage();
        const overview = await screen.findByTestId('guild-overview');
        expect(within(overview).getByTestId('module-widget')).toHaveTextContent('Uptime 99%');
    });

    it('drops the whole module while its plugin is inactive', async () => {
        usePluginStore.setState({ activeSlugs: new Set<string>(), initialized: true });
        renderPage();
        const nav = await screen.findByRole('navigation', { name: 'Guild page sections' });
        expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Overview', 'Members', 'Events']);
        expect(screen.queryByTestId('module-widget')).not.toBeInTheDocument();
    });
});

/**
 * ROK-1918 L4 — the Overview applies the hub's saved `widgetPrefs`: saved order,
 * hidden default-on widgets, added opt-in widgets, unknown ids ignored, and no
 * change at all when nothing is saved.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, within } from '@testing-library/react';
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

const PAGE: GuildPageDto = {
    guild: { id: 7, gameId: 1, kind: 'game_server', name: 'Longhouse', region: 'us', realmSlug: null, realmName: null, faction: null, memberCount: 2, lastSnapshotAt: null },
    importedBy: null,
    viewer: { role: 'member', canEdit: false, canManageEditors: false },
    ranks: [],
    roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
};

const Uptime = (): JSX.Element => <p data-testid="w-uptime">Uptime</p>;
const Notes = (): JSX.Element => <p data-testid="w-notes">Notes</p>;

const testModule: HubModule = {
    kind: 'game_server',
    tabs: [],
    overviewWidgets: [
        { id: 'uptime', order: 50, component: Uptime },
        { id: 'notes', title: 'Notes', order: 55, defaultOn: false, component: Notes },
    ],
    memberColumns: [],
    heroPills: [],
    memberRows: () => [],
};

function serve(widgetPrefs: HubWidgetPrefs | null | undefined): void {
    const body = widgetPrefs === undefined ? PAGE : { ...PAGE, widgetPrefs };
    server.use(http.get(BASE, () => HttpResponse.json(body)));
}

async function overview(): Promise<HTMLElement> {
    renderWithProviders(<Routes><Route path="/hubs/:id" element={<GuildPage />} /></Routes>, { initialEntries: ['/hubs/7'] });
    return screen.findByTestId('guild-overview');
}

function prefs(over: Partial<HubWidgetPrefs>): HubWidgetPrefs {
    return { order: [], hidden: [], added: [], config: {}, ...over };
}

beforeEach(() => {
    clearRegistry();
    registerPlugin(SLUG, { icon: '/x.png', color: 'blue', label: 'Test game' }).registerHubModule(testModule);
    usePluginStore.setState({ activeSlugs: new Set([SLUG]), initialized: true });
});

afterEach(() => {
    clearRegistry();
    usePluginStore.setState({ activeSlugs: new Set<string>(), initialized: true });
});

describe('HubOverview applies widgetPrefs (ROK-1918)', () => {
    it.each([['absent', undefined], ['null', null]] as const)('renders the registry default when widgetPrefs is %s', async (_label, p) => {
        serve(p);
        const grid = await overview();
        expect(within(grid).getByTestId('w-uptime')).toBeInTheDocument();
        expect(within(grid).queryByTestId('w-notes')).not.toBeInTheDocument();
    });

    it('shows an added opt-in widget in its saved place, ahead of a default one', async () => {
        serve(prefs({ order: ['module:notes', 'module:uptime'], added: ['module:notes'] }));
        const grid = await overview();
        const notes = await within(grid).findByTestId('w-notes');
        const uptime = within(grid).getByTestId('w-uptime');
        expect(notes.compareDocumentPosition(uptime) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('drops a hidden default-on widget and ignores ids no widget has', async () => {
        serve(prefs({ order: ['plugin:gone:x', 'module:uptime'], hidden: ['module:uptime', 'plugin:gone:y'] }));
        const grid = await overview();
        expect(within(grid).queryByTestId('w-uptime')).not.toBeInTheDocument();
        expect(within(grid).queryByTestId('w-notes')).not.toBeInTheDocument();
    });
});

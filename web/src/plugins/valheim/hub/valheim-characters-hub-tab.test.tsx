/** ROK-1836 — the Characters tab is registered on Valheim server hubs through the ROK-1831 seam. */
import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { GuildPage } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    VALHEIM_CHARACTERS_URL,
    valheimCharacterClaimed,
    valheimCharacterUnclaimed,
} from '../../../test/mocks/valheim-armory-handlers';
import type { HubCtx } from '../../hub-module';
import { serverHubGameTabs } from '../../pelican/hub/server-hub-game-tabs';
import '../register';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    getAuthToken: vi.fn(() => 'test-token'),
}));

/** Never read by the tab — spelled out rather than cast (pelican-hub-module.test idiom). */
const IDLE_RAIDS: HubCtx['raids'] = {
    data: undefined,
    error: null,
    isPending: true,
    isLoading: true,
    isLoadingError: false,
    isRefetchError: false,
    isSuccess: false,
    isError: false,
    isFetched: false,
    isFetchedAfterMount: false,
    isFetching: false,
    isInitialLoading: true,
    isPaused: false,
    isPlaceholderData: false,
    isRefetching: false,
    isStale: false,
    isEnabled: true,
    status: 'pending',
    fetchStatus: 'fetching',
    dataUpdatedAt: 0,
    errorUpdatedAt: 0,
    failureCount: 0,
    failureReason: null,
    errorUpdateCount: 0,
    refetch: () => Promise.reject(new Error('not used')),
};

function ctx(gameSlug: string): HubCtx {
    const page: GuildPage = {
        guild: {
            id: 9,
            gameId: 3,
            kind: 'game_server',
            name: 'Valheim — Main',
            region: 'server',
            realmSlug: null,
            realmName: null,
            faction: null,
            memberCount: 1,
            lastSnapshotAt: null,
        },
        importedBy: null,
        viewer: { role: 'member', canEdit: false, canManageEditors: false },
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
        server: {
            pelicanServerId: 7,
            gameSlug,
            gameIconUrl: null,
            state: 'running',
            viewerJoined: true,
        },
    };
    return { page, raids: IDLE_RAIDS };
}

function charactersTab() {
    const tab = serverHubGameTabs().find((t) => t.id === 'characters');
    if (tab === undefined) throw new Error('characters tab not registered');
    return tab;
}

describe('Valheim hub Characters tab (ROK-1836)', () => {
    it('tab is registered for valheim hubs and renders the list', async () => {
        let asked = '';
        server.use(
            http.get(VALHEIM_CHARACTERS_URL, ({ request }) => {
                asked = new URL(request.url).search;
                return HttpResponse.json({
                    data: [valheimCharacterUnclaimed, valheimCharacterClaimed],
                });
            }),
        );
        const tab = charactersTab();
        expect(tab.label).toBe('Characters');
        expect(tab.order).toBe(15);
        expect(tab.visible?.(ctx('valheim'))).toBe(true);
        expect(tab.visible?.(ctx('minecraft'))).toBe(false);
        const Tab = tab.component;
        renderWithProviders(<Tab {...ctx('valheim')} />);
        const list = await screen.findByRole('list');
        expect(asked).toBe('?serverId=7&page=1&pageSize=50');
        expect(within(list).getAllByRole('listitem')).toHaveLength(2);
        expect(within(list).getByText('Hrafn')).toBeInTheDocument();
    });
});

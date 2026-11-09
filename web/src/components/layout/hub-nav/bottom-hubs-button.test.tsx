/**
 * ROK-2152 Q1 — the phone centre Hubs circle follows the header's rule: a
 * viewer with no hubs of their own still gets the sheet (popular only) once
 * `/guilds/mine` has settled and there is a popular hub to suggest; with
 * neither, the plain `/hubs` link (ROK-1875 D1).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { HubDirectoryEntry } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { createTestQueryClient, renderWithProviders } from '../../../test/render-helpers';
import { createMockHubDirectoryPage, createMockHubEntry } from '../../../test/handlers/community-hubs';
import { BottomHubsButton } from './bottom-hubs-button';
import { popularHubsKey } from './popular-hubs-queries';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
    // The real useViewerCacheScope calls the module-internal useAuth, which the mock above does not reach.
    useViewerCacheScope: () => 1,
}));

vi.mock('../../ui/bottom-sheet-viewport', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../ui/bottom-sheet-viewport')>()),
    useVisibleViewport: () => ({ height: 1000, offsetTop: 0 }),
}));

const API = 'http://localhost:3000';

function serve(popular: HubDirectoryEntry[]): void {
    server.use(
        http.get(`${API}/guilds/mine`, () => HttpResponse.json({ guilds: [] })),
        http.get(`${API}/hubs`, () => HttpResponse.json(createMockHubDirectoryPage({ items: popular }))),
    );
}

/** `useMyGuildsQuery`'s key for the mocked viewer 1. */
const MINE_KEY = ['plugins', 'wow', 'guilds', 'mine', 1] as const;

beforeEach(() => { server.events.removeAllListeners(); });

describe('BottomHubsButton — Popular hubs for a viewer with no hubs (ROK-2152 Q1)', () => {
    it('no hubs + popular hubs → the sheet trigger, and the sheet lists the popular hubs only', async () => {
        serve([createMockHubEntry({ id: 501, name: 'Popular 1' }), createMockHubEntry({ id: 502, name: 'Popular 2' })]);
        renderWithProviders(<BottomHubsButton pathname="/players" />);
        await userEvent.click(await screen.findByTestId('bottom-hubs-trigger'));
        expect(screen.queryByTestId('bottom-hubs-link')).not.toBeInTheDocument();
        const sheet = await screen.findByTestId('bottom-hubs-sheet');
        expect(within(sheet).queryAllByTestId('guild-entry-row')).toHaveLength(0);
        expect(within(sheet).getAllByTestId('popular-hub-row').map((r) => r.getAttribute('href'))).toEqual(['/hubs/501', '/hubs/502']);
        expect(within(sheet).getByTestId('popular-hubs-section').className, 'no divider above the first section').not.toContain('border-t');
    });

    it('no hubs + no popular hubs → the plain /hubs link (D1)', async () => {
        serve([]);
        const queryClient = createTestQueryClient();
        renderWithProviders(<BottomHubsButton pathname="/players" />, { queryClient });
        await waitFor(() => {
            expect(queryClient.getQueryState(MINE_KEY)?.status, 'the /guilds/mine read landed').toBe('success');
            expect(queryClient.getQueryState(popularHubsKey(1))?.status, 'the popular read landed').toBe('success');
        });
        expect(screen.getByTestId('bottom-hubs-link')).toHaveAttribute('href', '/hubs');
        expect(screen.queryByTestId('bottom-hubs-trigger')).not.toBeInTheDocument();
    });
});

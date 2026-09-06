/**
 * ROK-1464 AC8/AC9 — the group page shell.
 *
 * The page is slug-addressed but every read is id-keyed, so the one thing that
 * MUST hold is the resolution order: slug → id → panels. A failed lookup is a
 * not-found state, never a burst of `/lfg/undefined` requests.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import {
    createMockLfgGroupDetail,
    createMockLfgIntent,
    createMockLfgPlayingNow,
} from '../../test/lfg-factories';
import {
    lfgGroupPageHandlers,
    LFG_TEST_SLUG,
} from '../../test/mocks/lfg-handlers';
import { Route, Routes } from 'react-router-dom';
import { ACCESS_TOKEN_KEY } from '../../lib/api/auth-storage-keys';
import { LfgGroupPage } from './lfg-group-page';

const API_BASE = 'http://localhost:3000';

function renderPage(slug = LFG_TEST_SLUG) {
    return renderWithProviders(
        <Routes>
            <Route path="/lfg/:gameSlug" element={<LfgGroupPage />} />
        </Routes>,
        { initialEntries: [`/lfg/${slug}`] },
    );
}

beforeEach(() => {
    // The page and every LFG read are jwt-gated; ROK-1453's group hook is
    // `enabled: !!token`, so without this the queries never fire.
    localStorage.setItem(ACCESS_TOKEN_KEY, 'test-token');
    server.use(...lfgGroupPageHandlers);
});

describe('LfgGroupPage', () => {
    it('resolves the slug and renders every section', async () => {
        renderPage();

        expect(
            await screen.findByRole('heading', { name: 'Deep Rock Galactic' }),
        ).toBeInTheDocument();
        expect(await screen.findByTestId('lfg-status-bar')).toBeInTheDocument();
        expect(
            await screen.findByTestId('lfg-overlap-panel'),
        ).toBeInTheDocument();
        expect(
            await screen.findByTestId('lfg-history-panel'),
        ).toBeInTheDocument();
        expect(
            await screen.findByTestId('lfg-suggestions-panel'),
        ).toBeInTheDocument();
        expect(screen.queryByTestId('lfg-not-found')).toBeNull();
    });

    it('links the header back to the game detail page', async () => {
        renderPage();

        const link = await screen.findByRole('link', {
            name: /^details/i,
        });
        expect(link).toHaveAttribute('href', '/games/7');
    });

    it('has no accessibility violations once every panel has resolved', async () => {
        const { container } = renderPage();

        // Axe must see the SETTLED page: the loading skeleton has no headings
        // and no controls, so running before the panels land would pass
        // vacuously. Wait for the last panel to mount first.
        await screen.findByTestId('lfg-suggestions-panel');
        expect(await axe(container)).toHaveNoViolations();
    });

    it('shows the not-found state for an unknown slug', async () => {
        renderPage('not-a-real-game');

        expect(await screen.findByTestId('lfg-not-found')).toBeInTheDocument();
        expect(screen.queryByTestId('lfg-status-bar')).toBeNull();
    });
});

describe('LfgGroupPage — empty group', () => {
    it('invites the viewer to be the first when nobody is looking', async () => {
        server.use(
            http.get(`${API_BASE}/lfg/:gameId`, () =>
                HttpResponse.json(
                    createMockLfgGroupDetail({
                        activeCount: 0,
                        state: null,
                        members: [],
                    }),
                ),
            ),
        );
        renderPage();

        expect(
            await screen.findByText(
                "Nobody's looking for a group right now — be the first",
            ),
        ).toBeInTheDocument();
        await waitFor(() =>
            expect(screen.queryByTestId('lfg-full-group-prompt')).toBeNull(),
        );
    });
});

describe('LfgGroupPage — failed reads', () => {
    it('shows an error state instead of an endless skeleton when the group read fails', async () => {
        server.use(
            http.get(`${API_BASE}/lfg/:gameId`, () =>
                HttpResponse.json({ message: 'boom' }, { status: 500 }),
            ),
        );
        renderPage();

        expect(await screen.findByTestId('lfg-not-found')).toBeInTheDocument();
        expect(screen.queryByTestId('lfg-loading')).toBeNull();
    });
});

/**
 * ROK-1494 AC3 — the whole page while a spawned session is live.
 *
 * Asserted here rather than only on the bar because the page carries TWO
 * Find-a-time buttons (status bar + viability prompt); suppressing one and
 * leaving the other would still offer a poll to a group already in voice.
 */
describe('LfgGroupPage — playing now', () => {
    it('shows the session and offers no way to schedule one', async () => {
        server.use(
            http.get(`${API_BASE}/lfg/:gameId`, () =>
                HttpResponse.json(
                    createMockLfgGroupDetail({
                        // What a spawn actually leaves behind: the intents
                        // converted, so the count is 0 while the session runs.
                        activeCount: 0,
                        nowCount: 0,
                        state: null,
                        members: [],
                        isViable: true,
                        viabilityThreshold: 2,
                        ownIntent: createMockLfgIntent(),
                        playingNow: createMockLfgPlayingNow({ eventId: 4242 }),
                    }),
                ),
            ),
        );
        renderPage();

        expect(
            await screen.findByTestId('lfg-playing-now'),
        ).toBeInTheDocument();
        expect(screen.getByTestId('lfg-playing-now-event')).toHaveAttribute(
            'href',
            '/events/4242',
        );
        expect(screen.queryByText('Find a time')).toBeNull();
        expect(screen.queryByTestId('lfg-full-group-prompt')).toBeNull();
        expect(
            screen.queryByText(
                "Nobody's looking for a group right now — be the first",
            ),
        ).toBeNull();
    });
});

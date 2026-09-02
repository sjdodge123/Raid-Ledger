/**
 * ROK-1464 AC8/AC9 — the group page shell.
 *
 * The page is slug-addressed but every read is id-keyed, so the one thing that
 * MUST hold is the resolution order: slug → id → panels. A failed lookup is a
 * not-found state, never a burst of `/lfg/undefined` requests.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { createMockLfgGroupDetail } from '../../test/lfg-factories';
import { lfgHandlers, LFG_TEST_SLUG } from '../../test/mocks/lfg-handlers';
import { Route, Routes } from 'react-router-dom';
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
    server.use(...lfgHandlers);
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

    it('links co-op attribution back to the game detail page', async () => {
        renderPage();

        const link = await screen.findByRole('link', {
            name: /co-op details/i,
        });
        expect(link).toHaveAttribute('href', '/games/7');
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

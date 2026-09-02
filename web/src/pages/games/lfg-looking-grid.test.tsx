/**
 * ROK-1453 — the `?lfg=1` grid's non-success states (Codex follow-up).
 *
 * `GET /lfg` is jwt-gated, so for a logged-out viewer the query never runs and
 * `data` is `undefined` forever. Reading that as "nobody is looking" tells the
 * viewer something the app has not established — the empty copy belongs to a
 * RESOLVED empty array and nothing else.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { server } from '../../test/mocks/server';
import { lfgGroupsHandler } from '../../test/mocks/lfg-handlers';
import { buildLfgGroupSummary } from '../../test/factories/lfg';
import { ACCESS_TOKEN_KEY } from '../../lib/api/auth-storage-keys';
import { renderWithProviders } from '../../test/render-helpers';
import { LfgLookingGrid } from './lfg-looking-grid';

const EMPTY_COPY = /nobody is looking right now/i;

function renderGrid() {
    return renderWithProviders(<LfgLookingGrid />, {
        initialEntries: ['/games?lfg=1'],
    });
}

beforeEach(() => {
    localStorage.clear();
});

describe('LfgLookingGrid — non-success states', () => {
    it('does not claim nobody is looking while the query is disabled', async () => {
        // No token ⇒ `enabled: false` ⇒ the request is never made.
        server.use(lfgGroupsHandler([buildLfgGroupSummary({ gameId: 1 })]));

        renderGrid();

        // Give the tree the same beat a resolved query would have taken.
        await waitFor(() => {
            expect(screen.queryByText(EMPTY_COPY)).not.toBeInTheDocument();
        });
        expect(screen.queryAllByTestId('lfg-looking-tile')).toHaveLength(0);
    });

    it('shows the empty copy once GET /lfg resolves to an empty list', async () => {
        localStorage.setItem(ACCESS_TOKEN_KEY, 'test-token');
        server.use(lfgGroupsHandler([]));

        renderGrid();

        expect(await screen.findByText(EMPTY_COPY)).toBeInTheDocument();
    });

    it('renders a tile per group once the list resolves', async () => {
        localStorage.setItem(ACCESS_TOKEN_KEY, 'test-token');
        server.use(
            lfgGroupsHandler([
                buildLfgGroupSummary({ gameId: 1, gameName: 'Looking One' }),
                buildLfgGroupSummary({ gameId: 2, gameName: 'Looking Two' }),
            ]),
        );

        renderGrid();

        expect(await screen.findByText('Looking One')).toBeInTheDocument();
        expect(screen.getAllByTestId('lfg-looking-tile')).toHaveLength(2);
        expect(screen.queryByText(EMPTY_COPY)).not.toBeInTheDocument();
    });
});

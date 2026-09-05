/**
 * ROK-1453 AC6 — hearting a game has to reach the cold-start prompt.
 *
 * Operator walk: two games were hearted on the deployed env (`source='manual'`
 * rows confirmed in the DB) and the prompt never appeared. `GET /lfg/hearted`
 * carries a 5-minute `staleTime` and nothing invalidated it, so the games page
 * kept serving the pre-heart empty list for the rest of the session.
 *
 * Both heart paths are covered: the batch provider used by the tiles and the
 * individual mutation the detail page falls back to.
 */
import type { JSX } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '../test/mocks/server';
import { ACCESS_TOKEN_KEY } from '../lib/api/auth-storage-keys';
import { WantToPlayProvider } from './use-want-to-play-batch';
import { useWantToPlay } from './use-want-to-play';
import { useLfgHearted } from './use-lfg-hearted';

const GAME_ID = 7;

vi.mock('../lib/toast', () => ({
    toast: { error: vi.fn(), success: vi.fn() },
}));

/** Count every `GET /lfg/hearted` the tree issues. */
function countHeartedReads(): string[] {
    const calls: string[] = [];
    server.use(
        http.get('http://localhost:3000/lfg/hearted', ({ request }) => {
            calls.push(request.url);
            return HttpResponse.json([]);
        }),
        http.post(`http://localhost:3000/games/${GAME_ID}/want-to-play`, () =>
            HttpResponse.json({ wantToPlay: true, count: 1 }),
        ),
        http.get('http://localhost:3000/games/interest/batch', () =>
            HttpResponse.json({ data: {} }),
        ),
        http.get(`http://localhost:3000/games/${GAME_ID}/interest`, () =>
            HttpResponse.json({ wantToPlay: false, count: 0 }),
        ),
    );
    return calls;
}

/** Renders the prompt's query alongside a heart button. */
function Harness(): JSX.Element {
    const { toggle } = useWantToPlay(GAME_ID);
    const { data } = useLfgHearted();
    return (
        <>
            <button type="button" onClick={() => toggle(true)}>
                Heart it
            </button>
            <span data-testid="hearted-count">{data?.length ?? -1}</span>
        </>
    );
}

function renderHarness(withProvider: boolean) {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    const inner = withProvider ? (
        <WantToPlayProvider gameIds={[GAME_ID]}>
            <Harness />
        </WantToPlayProvider>
    ) : (
        <Harness />
    );
    return render(
        <QueryClientProvider client={client}>
            <MemoryRouter>{inner}</MemoryRouter>
        </QueryClientProvider>,
    );
}

beforeEach(() => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'test-token');
});

describe('hearting a game refreshes the cold-start prompt (AC6)', () => {
    it('refetches GET /lfg/hearted after the batch provider toggle', async () => {
        const calls = countHeartedReads();
        const user = userEvent.setup();
        renderHarness(true);

        await waitFor(() => expect(calls.length).toBe(1));

        await user.click(screen.getByRole('button', { name: 'Heart it' }));

        // The heart landed — the prompt's source of truth must be re-read, not
        // served from the 5-minute-stale cache.
        await waitFor(() => expect(calls.length).toBeGreaterThan(1));
    });

    it('refetches GET /lfg/hearted after the individual toggle', async () => {
        const calls = countHeartedReads();
        const user = userEvent.setup();
        renderHarness(false);

        await waitFor(() => expect(calls.length).toBe(1));

        await user.click(screen.getByRole('button', { name: 'Heart it' }));

        await waitFor(() => expect(calls.length).toBeGreaterThan(1));
    });
});

/**
 * ROK-1453 (operator addition) — the "Looking for group" toggle on the game
 * detail page.
 *
 * Until now the chips could only be *read*: nothing in the UI raised an intent,
 * so the only way to see a chip was to POST /lfg by hand. This button is the
 * write half — and because every LFG surface (header chip, events banner,
 * cold-start prompt) is a cached read, the invalidation is as much a part of
 * the contract as the copy.
 *
 * TDD: `./lfg-toggle-button` does not exist yet.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '../../test/mocks/server';
import { buildLfgGroupSummary } from '../../test/factories/lfg';
import { ACCESS_TOKEN_KEY } from '../../lib/api/auth-storage-keys';
import { LfgToggleButton } from './lfg-toggle-button';

const GAME_ID = 42;

vi.mock('../../lib/toast', () => ({
    toast: { error: vi.fn(), success: vi.fn() },
}));

/**
 * `POST /lfg` — the intent plus the derived group. Spelled out in full because
 * the client parses the write response with `LfgIntentResponseSchema`: a short
 * fixture would fail validation and the mutation would never reach onSuccess,
 * which is exactly the invalidation this file asserts.
 */
function intentResponse() {
    return {
        id: 1,
        userId: 9,
        gameId: GAME_ID,
        status: 'active',
        visibility: 'local',
        createdAt: '2026-09-02T00:00:00.000Z',
        expiresAt: '2026-09-09T00:00:00.000Z',
        convertedToPollId: null,
        convertedToEventId: null,
        group: buildLfgGroupSummary({ gameId: GAME_ID, hasOwnIntent: true }),
    };
}

/** `GET /lfg/:gameId` — the summary plus the roster and the caller's own row. */
function groupDetail(hasOwnIntent: boolean) {
    return {
        ...buildLfgGroupSummary({ gameId: GAME_ID, hasOwnIntent }),
        members: [],
        ownIntent: null,
    };
}

interface Calls {
    detail: number;
    posted: { gameId: number }[];
    deleted: string[];
}

function seed(hasOwnIntent: boolean): Calls {
    const calls: Calls = { detail: 0, posted: [], deleted: [] };
    server.use(
        http.get(`http://localhost:3000/lfg/${GAME_ID}`, () => {
            calls.detail += 1;
            return HttpResponse.json(groupDetail(hasOwnIntent));
        }),
        http.post('http://localhost:3000/lfg', async ({ request }) => {
            calls.posted.push((await request.json()) as { gameId: number });
            return HttpResponse.json(intentResponse(), { status: 201 });
        }),
        http.delete(`http://localhost:3000/lfg/${GAME_ID}`, ({ request }) => {
            calls.deleted.push(request.url);
            return new HttpResponse(null, { status: 204 });
        }),
    );
    return calls;
}

function renderButton() {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    return render(
        <QueryClientProvider client={client}>
            <MemoryRouter>
                <LfgToggleButton gameId={GAME_ID} />
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

beforeEach(() => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'test-token');
});

describe('LfgToggleButton — raising an intent', () => {
    it('offers to look for a group and posts the intent', async () => {
        const calls = seed(false);
        const user = userEvent.setup();
        renderButton();

        const button = await screen.findByTestId('lfg-toggle');
        expect(button).toHaveTextContent('🎯 Looking for group');
        expect(button).toHaveAttribute('aria-pressed', 'false');

        await user.click(button);

        await waitFor(() => expect(calls.posted).toHaveLength(1));
        expect(calls.posted[0]).toEqual({ gameId: GAME_ID });
        expect(calls.deleted).toHaveLength(0);
    });
});

describe('LfgToggleButton — withdrawing', () => {
    it('reads as withdrawable and deletes the intent', async () => {
        const calls = seed(true);
        const user = userEvent.setup();
        renderButton();

        const button = await screen.findByTestId('lfg-toggle');
        await waitFor(() =>
            expect(button).toHaveTextContent('🎯 Looking (Withdraw)'),
        );
        expect(button).toHaveAttribute('aria-pressed', 'true');

        await user.click(button);

        await waitFor(() => expect(calls.deleted).toHaveLength(1));
        expect(calls.posted).toHaveLength(0);
    });
});

describe('LfgToggleButton — cache invalidation', () => {
    it('re-reads the LFG queries so the chip and banners catch up', async () => {
        // The header chip, the events banner and the cold-start prompt are all
        // cached reads under the ['lfg'] prefix. Without this the button
        // "works" and the page keeps showing the pre-click world.
        const calls = seed(false);
        const user = userEvent.setup();
        renderButton();

        await screen.findByTestId('lfg-toggle');
        await waitFor(() => expect(calls.detail).toBe(1));

        await user.click(screen.getByTestId('lfg-toggle'));

        await waitFor(() => expect(calls.detail).toBeGreaterThan(1));
    });
});

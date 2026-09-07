/**
 * ROK-1457 — the lineup → LFG bridge prompt on the decided page (spec D8,
 * T-8…T-11).
 *
 * Contract pinned here:
 *   • data comes from `GET /lfg/bridge/:lineupId` — the SERVER decides who
 *     qualifies (nominators of losing games with no live intent), so the
 *     client renders exactly what it is given and NOTHING for `[]`;
 *   • a tap raises a hand through `useJoinGroup` → `POST /lfg { gameId }`,
 *     once — the client never writes an intent any other way;
 *   • the joined game leaves the list (the ['lfg'] invalidation refetches
 *     the bridge read, which no longer lists it) and an inline confirmation
 *     links to `/lfg/<slug>`;
 *   • dismissal is session-scoped under `lfg-bridge-prompt-dismissed:<id>`;
 *   • entries wear `lfg-bridge-prompt-game`, never `lfg-chip` (ROK-1453 D9).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { lfgBridgeHandler } from '../../../test/mocks/lfg-handlers';
import {
    buildLfgBridgeOffer,
    buildLfgIntentResponse,
} from '../../../test/factories/lfg';
import { renderWithProviders } from '../../../test/render-helpers';
import { lfgBridgeQueryKey } from '../../../hooks/use-lfg-bridge';
import { LfgBridgePrompt } from './LfgBridgePrompt';
import type { QueryClient } from '@tanstack/react-query';

const LINEUP_ID = 42;
const DISMISS_KEY = `lfg-bridge-prompt-dismissed:${LINEUP_ID}`;
const API = 'http://localhost:3000';

// `fetchApi` reads the bearer token through this module too, so the mock has
// to carry `getAuthToken` or every request throws before reaching MSW.
vi.mock('../../../hooks/use-auth', () => ({
    useAuth: () => ({ user: { id: 99, username: 'me' } }),
    getAuthToken: () => 'test-token',
    isOperatorOrAdmin: () => false,
    isAdmin: () => false,
}));

function offers(n: number) {
    return Array.from({ length: n }, (_, i) =>
        buildLfgBridgeOffer({
            gameId: i + 1,
            gameName: `Lost Game ${i + 1}`,
            gameSlug: `lost-game-${i + 1}`,
            lineupId: LINEUP_ID,
        }),
    );
}

function renderPrompt(count: number) {
    server.use(lfgBridgeHandler(offers(count)));
    return renderWithProviders(<LfgBridgePrompt lineupId={LINEUP_ID} />, {
        initialEntries: [`/lineups/${LINEUP_ID}`],
    });
}

/**
 * Wait until the bridge read has actually RESOLVED. A "renders nothing"
 * assertion made before the response lands passes vacuously (no data yet ⇒
 * nothing to render), so every absence check below waits for this first.
 */
async function awaitBridgeRead(queryClient: QueryClient): Promise<void> {
    await waitFor(() =>
        expect(
            queryClient.getQueryState(lfgBridgeQueryKey(LINEUP_ID))?.status,
        ).toBe('success'),
    );
}

beforeEach(() => {
    sessionStorage.clear();
});

describe('LfgBridgePrompt — visibility (T-10)', () => {
    it('renders nothing when the server offers nothing (winner / active intent / not a nominator)', async () => {
        const hits: string[] = [];
        server.use(
            http.get(`${API}/lfg/bridge/:lineupId`, ({ request }) => {
                hits.push(new URL(request.url).pathname);
                return HttpResponse.json([]);
            }),
        );
        const { queryClient } = renderWithProviders(
            <LfgBridgePrompt lineupId={LINEUP_ID} />,
        );

        // The read happens (scoped to THIS lineup) and answers empty …
        await awaitBridgeRead(queryClient);
        expect(hits).toEqual([`/lfg/bridge/${LINEUP_ID}`]);
        // … so no banner, no zero-height placeholder.
        expect(screen.queryByTestId('lfg-bridge-prompt')).not.toBeInTheDocument();
    });

    it('renders nothing when this lineup was already dismissed this session', async () => {
        sessionStorage.setItem(DISMISS_KEY, '1');
        const { queryClient } = renderPrompt(2);

        // Offers DID arrive — the dismissal alone is what keeps it hidden.
        await awaitBridgeRead(queryClient);
        expect(screen.queryByTestId('lfg-bridge-prompt')).not.toBeInTheDocument();
    });

    it('is not hidden by another lineup’s dismissal', async () => {
        sessionStorage.setItem('lfg-bridge-prompt-dismissed:7', '1');
        renderPrompt(1);

        expect(await screen.findByTestId('lfg-bridge-prompt')).toBeInTheDocument();
    });
});

describe('LfgBridgePrompt — entries (T-9)', () => {
    it('renders one hand-raise button per offer, labelled per game', async () => {
        renderPrompt(2);

        await screen.findByTestId('lfg-bridge-prompt');
        const entries = screen.getAllByTestId('lfg-bridge-prompt-game');
        expect(entries).toHaveLength(2);
        expect(entries[0]).toHaveAttribute('aria-label', "I'm up for Lost Game 1");
        expect(entries[1]).toHaveAttribute('aria-label', "I'm up for Lost Game 2");
        expect(entries[0].tagName).toBe('BUTTON');
        expect(
            screen.getByText(/Didn.t make the cut\? Say you.re still up for it/),
        ).toBeInTheDocument();
    });

    it('caps at three entries and summarises the rest', async () => {
        renderPrompt(5);

        await screen.findByTestId('lfg-bridge-prompt');
        expect(screen.getAllByTestId('lfg-bridge-prompt-game')).toHaveLength(3);
        expect(screen.getByText(/and 2 more/i)).toBeInTheDocument();
        expect(screen.queryByText('Lost Game 4')).not.toBeInTheDocument();
    });

    it('does not reuse the tile-chip testid anywhere in its subtree', async () => {
        renderPrompt(3);

        await screen.findByTestId('lfg-bridge-prompt');
        expect(screen.queryAllByTestId('lfg-chip')).toHaveLength(0);
    });
});

describe('LfgBridgePrompt — raising a hand (T-8, T-11)', () => {
    /** Capture POSTs and let the bridge list shrink between reads. */
    function seedJoin(remaining: number[] = []) {
        const posted: { gameId: number }[] = [];
        let reads = 0;
        server.use(
            http.get(`${API}/lfg/bridge/:lineupId`, () => {
                reads += 1;
                // First read: everything. After the join invalidates ['lfg'],
                // the server no longer lists a game the caller now holds a
                // live intent on — so neither does the second read.
                const all = offers(2);
                return HttpResponse.json(
                    reads === 1
                        ? all
                        : all.filter((o) => remaining.includes(o.gameId)),
                );
            }),
            http.post(`${API}/lfg`, async ({ request }) => {
                const body = (await request.json()) as { gameId: number };
                posted.push(body);
                return HttpResponse.json(buildLfgIntentResponse(body.gameId), {
                    status: 201,
                });
            }),
        );
        return posted;
    }

    it('posts POST /lfg exactly once, for the game that was tapped', async () => {
        const posted = seedJoin([2]);
        const user = userEvent.setup();
        renderWithProviders(<LfgBridgePrompt lineupId={LINEUP_ID} />);

        await screen.findByTestId('lfg-bridge-prompt');
        await user.click(screen.getByLabelText("I'm up for Lost Game 1"));

        await waitFor(() => expect(posted).toHaveLength(1));
        expect(posted).toEqual([{ gameId: 1 }]);
        // The untouched offer is still there — one tap, one game.
        expect(screen.getByLabelText("I'm up for Lost Game 2")).toBeInTheDocument();
    });

    it('drops the joined game, confirms inline, and links to the group', async () => {
        seedJoin([2]);
        const user = userEvent.setup();
        renderWithProviders(<LfgBridgePrompt lineupId={LINEUP_ID} />);

        await screen.findByTestId('lfg-bridge-prompt');
        await user.click(screen.getByLabelText("I'm up for Lost Game 1"));

        await waitFor(() => {
            expect(
                screen.queryByLabelText("I'm up for Lost Game 1"),
            ).not.toBeInTheDocument();
        });
        const confirmation = await screen.findByTestId('lfg-bridge-confirm');
        expect(confirmation).toHaveTextContent(
            "You're looking for Lost Game 1 — others can join you",
        );
        expect(
            within(confirmation).getByRole('link', { name: /group/i }),
        ).toHaveAttribute('href', '/lfg/lost-game-1');
    });

    it('keeps the confirmation on screen after the last offer is joined', async () => {
        seedJoin([]);
        const user = userEvent.setup();
        renderWithProviders(<LfgBridgePrompt lineupId={LINEUP_ID} />);

        await screen.findByTestId('lfg-bridge-prompt');
        await user.click(screen.getByLabelText("I'm up for Lost Game 1"));

        await screen.findByTestId('lfg-bridge-confirm');
        await waitFor(() => {
            expect(
                screen.queryAllByTestId('lfg-bridge-prompt-game'),
            ).toHaveLength(0);
        });
        expect(screen.getByTestId('lfg-bridge-prompt')).toBeInTheDocument();
    });

    it('disables the entry while the intent is in flight', async () => {
        let release: (() => void) | undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        server.use(
            lfgBridgeHandler(offers(2)),
            http.post(`${API}/lfg`, async () => {
                await gate;
                return HttpResponse.json(buildLfgIntentResponse(), {
                    status: 201,
                });
            }),
        );
        const user = userEvent.setup();
        renderWithProviders(<LfgBridgePrompt lineupId={LINEUP_ID} />);

        await screen.findByTestId('lfg-bridge-prompt');
        const entry = screen.getByLabelText("I'm up for Lost Game 1");
        await user.click(entry);

        await waitFor(() => expect(entry).toBeDisabled());
        release!();
    });
});

describe('LfgBridgePrompt — dismissal (T-11)', () => {
    it('hides on dismiss and records the per-lineup session flag', async () => {
        const user = userEvent.setup();
        renderPrompt(2);

        await screen.findByTestId('lfg-bridge-prompt');
        await user.click(screen.getByRole('button', { name: 'Dismiss' }));

        expect(screen.queryByTestId('lfg-bridge-prompt')).not.toBeInTheDocument();
        expect(sessionStorage.getItem(DISMISS_KEY)).not.toBeNull();
    });

    it('stays hidden after a remount within the same session', async () => {
        const user = userEvent.setup();
        const { unmount } = renderPrompt(2);

        await screen.findByTestId('lfg-bridge-prompt');
        await user.click(screen.getByRole('button', { name: 'Dismiss' }));
        unmount();

        const { queryClient } = renderPrompt(2);
        await awaitBridgeRead(queryClient);
        expect(screen.queryByTestId('lfg-bridge-prompt')).not.toBeInTheDocument();
    });

    it('has no accessibility violations', async () => {
        const { container } = renderPrompt(3);

        await screen.findByTestId('lfg-bridge-prompt');
        expect(await axe(container)).toHaveNoViolations();
    });
});

/**
 * ROK-1453 AC6 — the cold-start prompt on the games page.
 *
 * TDD: `./lfg-hearted-prompt` does not exist yet, so this file fails at
 * import. That is the intended pre-implementation failure.
 *
 * Contract pinned here (spec §Files → `lfg-hearted-prompt.tsx`, D7):
 *   • data comes from `GET /lfg/hearted` (the server already excludes games
 *     the caller has a live intent on) — driven through MSW;
 *   • at most 3 game entries, then `and N more`;
 *   • an empty response renders NOTHING (the games-page banner stack must not
 *     grow a zero-height placeholder — `game-detail.smoke.spec.ts:20-38`);
 *   • dismissal is session-scoped under `lfg-hearted-prompt-dismissed`;
 *   • entries carry `data-testid="lfg-hearted-prompt-game"`, NOT
 *     `lfg-chip` — the tile-chip absence assertions in
 *     `lfg-chips.smoke.spec.ts` are page-scoped and unqualified (D9), so a
 *     prompt entry wearing the chip testid would break them.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { http, HttpResponse } from 'msw';
import type { QueryClient } from '@tanstack/react-query';
import { server } from '../../test/mocks/server';
import { lfgHeartedHandler } from '../../test/mocks/lfg-handlers';
import {
    buildLfgHeartedGame,
    buildLfgIntentResponse,
} from '../../test/factories/lfg';
import { ACCESS_TOKEN_KEY } from '../../lib/api/auth-storage-keys';
import { renderWithProviders } from '../../test/render-helpers';
import { LFG_COPY } from '../../pages/lfg/lfg-copy';
import { LFG_HEARTED_QUERY_KEY } from '../../hooks/use-lfg-hearted';
import { LfgHeartedPrompt } from './lfg-hearted-prompt';

const DISMISS_KEY = 'lfg-hearted-prompt-dismissed';

function hearted(n: number) {
    return Array.from({ length: n }, (_, i) =>
        buildLfgHeartedGame({
            gameId: i + 1,
            gameName: `Hearted Game ${i + 1}`,
            gameSlug: `hearted-game-${i + 1}`,
        }),
    );
}

function renderPrompt(count: number) {
    server.use(lfgHeartedHandler(hearted(count)));
    return renderWithProviders(<LfgHeartedPrompt />, {
        initialEntries: ['/games'],
    });
}

/**
 * ROK-1514 — block until `GET /lfg/hearted` has landed in the query cache.
 *
 * An absence assertion made straight after mount is vacuous: the prompt is
 * null while the read is pending regardless of dismissal, so `queryBy…` would
 * pass even if the prompt rendered once data arrived. Waiting on the query's
 * `success` status (the harness hands back the `QueryClient`) means the
 * assertion that follows sees the component AFTER it had every chance to
 * render — `waitFor` flushes the resulting React commit before returning.
 */
async function awaitHeartedRead(queryClient: QueryClient): Promise<void> {
    await waitFor(() => {
        expect(
            queryClient.getQueryState(LFG_HEARTED_QUERY_KEY)?.status,
        ).toBe('success');
    });
}

beforeEach(() => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'test-token');
    sessionStorage.clear();
});

describe('LfgHeartedPrompt — visibility', () => {
    it('renders nothing when the caller has no eligible hearts', async () => {
        const { queryClient } = renderPrompt(0);

        await awaitHeartedRead(queryClient);
        expect(
            screen.queryByTestId('lfg-hearted-prompt'),
        ).not.toBeInTheDocument();
    });

    it('renders nothing when the session was already dismissed', async () => {
        sessionStorage.setItem(DISMISS_KEY, '1');
        const { queryClient } = renderPrompt(3);

        // Three hearts are on the wire — only the dismissal keeps this null,
        // so the assertion has to wait for the read to land (ROK-1514).
        await awaitHeartedRead(queryClient);
        expect(
            screen.queryByTestId('lfg-hearted-prompt'),
        ).not.toBeInTheDocument();
    });
});

describe('LfgHeartedPrompt — entries', () => {
    it('lists every hearted game when there are three or fewer', async () => {
        renderPrompt(3);

        await screen.findByTestId('lfg-hearted-prompt');
        expect(
            screen.getAllByTestId('lfg-hearted-prompt-game'),
        ).toHaveLength(3);
        expect(screen.getByText('Hearted Game 1')).toBeInTheDocument();
        expect(screen.getByText('Hearted Game 3')).toBeInTheDocument();
        expect(screen.queryByText(/and \d+ more/i)).not.toBeInTheDocument();
    });

    it('caps at three entries and summarises the rest', async () => {
        renderPrompt(5);

        await screen.findByTestId('lfg-hearted-prompt');
        expect(
            screen.getAllByTestId('lfg-hearted-prompt-game'),
        ).toHaveLength(3);
        expect(screen.getByText(/and 2 more/i)).toBeInTheDocument();
        // The 4th and 5th are summarised, not rendered as entries.
        expect(screen.queryByText('Hearted Game 4')).not.toBeInTheDocument();
    });

    it('labels each entry as raising a hand, not as a link', async () => {
        // The prompt's own copy is "Say so and others can join you" — the user
        // has already hearted these games, so the click that follows that
        // sentence has to CREATE the intent. Sending them to a group page that
        // nobody (including them) has joined was the wrong verb.
        renderPrompt(1);

        await screen.findByTestId('lfg-hearted-prompt');
        const entry = screen.getByTestId('lfg-hearted-prompt-game');
        expect(entry).toHaveAttribute('aria-label', "I'm up for Hearted Game 1");
        expect(entry.tagName).toBe('BUTTON');
    });

    it('does not reuse the tile-chip testid for its entries', async () => {
        renderPrompt(3);

        await screen.findByTestId('lfg-hearted-prompt');
        expect(screen.queryAllByTestId('lfg-chip')).toHaveLength(0);
    });
});

describe('LfgHeartedPrompt — raising a hand (operator re-walk)', () => {
    /**
     * ROK-1479 added a SECOND click to this flow: the entry opens the urgency
     * choice and the horizon button is what posts. Every assertion below is
     * unchanged in strength — only `pickWeek()` is new, and the wire body now
     * carries the horizon the viewer picked.
     */
    async function pickWeek(user: ReturnType<typeof userEvent.setup>) {
        await user.click(
            await screen.findByRole('button', { name: LFG_COPY.urgencyWeek }),
        );
    }

    /** Capture POSTs and let the hearted list change between reads. */
    function seedJoin(remaining: number[] = []) {
        const posted: Record<string, unknown>[] = [];
        let reads = 0;
        server.use(
            http.get('http://localhost:3000/lfg/hearted', () => {
                reads += 1;
                // First read: everything. After the join invalidates ['lfg'],
                // the server no longer lists a game the caller now has a live
                // intent on — so neither does the second read.
                const all = hearted(2);
                return HttpResponse.json(
                    reads === 1
                        ? all
                        : all.filter((g) => remaining.includes(g.gameId)),
                );
            }),
            http.post('http://localhost:3000/lfg', async ({ request }) => {
                const body = (await request.json()) as Record<string, unknown>;
                posted.push(body);
                return HttpResponse.json(
                    buildLfgIntentResponse(Number(body.gameId)),
                    { status: 201 },
                );
            }),
        );
        return posted;
    }

    it('posts the intent for the game that was clicked', async () => {
        const posted = seedJoin([2]);
        const user = userEvent.setup();
        renderWithProviders(<LfgHeartedPrompt />, {
            initialEntries: ['/games'],
        });

        await screen.findByTestId('lfg-hearted-prompt');
        await user.click(screen.getByLabelText("I'm up for Hearted Game 1"));
        await pickWeek(user);

        await waitFor(() => expect(posted).toHaveLength(1));
        expect(posted[0]).toEqual({ gameId: 1, urgency: 'week' });
    });

    it('drops the game from the prompt and confirms, linking to the group', async () => {
        seedJoin([2]);
        const user = userEvent.setup();
        renderWithProviders(<LfgHeartedPrompt />, {
            initialEntries: ['/games'],
        });

        await screen.findByTestId('lfg-hearted-prompt');
        await user.click(screen.getByLabelText("I'm up for Hearted Game 1"));
        await pickWeek(user);

        // (a) the game leaves the prompt — the server excludes games the
        // caller now holds an intent on, and ['lfg'] was invalidated.
        await waitFor(() => {
            expect(
                screen.queryByLabelText("I'm up for Hearted Game 1"),
            ).not.toBeInTheDocument();
        });
        // (c) and the user is told what just happened, with somewhere to go —
        // a group exists NOW, which it did not before the click.
        const confirmation = await screen.findByTestId('lfg-hearted-confirm');
        expect(confirmation).toHaveTextContent(
            "You're looking for Hearted Game 1 — others can join you",
        );
        expect(
            within(confirmation).getByRole('link', { name: /group/i }),
        ).toHaveAttribute('href', '/lfg/hearted-game-1');
    });

    it('disables the chip while the intent is in flight', async () => {
        let release: (() => void) | undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        server.use(
            lfgHeartedHandler(hearted(2)),
            http.post('http://localhost:3000/lfg', async () => {
                await gate;
                return HttpResponse.json(buildLfgIntentResponse(), {
                    status: 201,
                });
            }),
        );
        const user = userEvent.setup();
        renderWithProviders(<LfgHeartedPrompt />, {
            initialEntries: ['/games'],
        });

        await screen.findByTestId('lfg-hearted-prompt');
        const entry = screen.getByLabelText("I'm up for Hearted Game 1");
        await user.click(entry);
        await pickWeek(user);

        await waitFor(() => expect(entry).toBeDisabled());
        release!();
    });
});

describe('LfgHeartedPrompt — dismissal (D7)', () => {
    it('hides on dismiss and records the session flag', async () => {
        const user = userEvent.setup();
        renderPrompt(3);

        await screen.findByTestId('lfg-hearted-prompt');
        await user.click(screen.getByRole('button', { name: 'Dismiss' }));

        expect(
            screen.queryByTestId('lfg-hearted-prompt'),
        ).not.toBeInTheDocument();
        // The key is a pinned contract (D7) — the smoke spec reloads the page
        // and expects the prompt to stay hidden, which only works if the flag
        // lands under this exact name.
        expect(sessionStorage.getItem(DISMISS_KEY)).not.toBeNull();
    });

    it('stays hidden after a remount within the same session', async () => {
        const user = userEvent.setup();
        const { unmount } = renderPrompt(3);

        await screen.findByTestId('lfg-hearted-prompt');
        await user.click(screen.getByRole('button', { name: 'Dismiss' }));
        unmount();

        const { queryClient } = renderPrompt(3);
        // Fresh QueryClient, fresh read — wait for it before asserting, or
        // the pending-state null would satisfy this on its own (ROK-1514).
        await awaitHeartedRead(queryClient);
        expect(
            screen.queryByTestId('lfg-hearted-prompt'),
        ).not.toBeInTheDocument();
    });

    it('does not inset itself inside the page container', async () => {
        // The games-page banner stack lives INSIDE `max-w-7xl mx-auto px-4`
        // (`games-page.tsx:99-101`), where `LineupBanner` — the sibling
        // directly above — carries no horizontal margin. `mx-4` here double
        // inset the prompt against every other block on the page.
        renderPrompt(3);

        const prompt = await screen.findByTestId('lfg-hearted-prompt');
        expect(prompt.className).not.toContain('mx-4');
        expect(prompt.className).toContain('rounded-xl');
    });

    it('has no accessibility violations', async () => {
        const { container } = renderPrompt(3);

        await screen.findByTestId('lfg-hearted-prompt');
        expect(await axe(container)).toHaveNoViolations();
    });
});

describe('LfgHeartedPrompt — the urgency choice (ROK-1479 AC5)', () => {
    /**
     * Same capture as `seedJoin` above, but typed for the 1479 body: the POST
     * now carries the urgency the viewer picked, so the assertions are on the
     * WIRE body rather than on the mutation's arguments — that is the thing
     * the API contract rejects or accepts.
     */
    function seedUrgencyJoin() {
        const posted: Record<string, unknown>[] = [];
        server.use(
            lfgHeartedHandler(hearted(2)),
            http.post('http://localhost:3000/lfg', async ({ request }) => {
                const body = (await request.json()) as Record<string, unknown>;
                posted.push(body);
                return HttpResponse.json(
                    buildLfgIntentResponse(Number(body.gameId)),
                    { status: 201 },
                );
            }),
        );
        return posted;
    }

    async function openChoice() {
        const user = userEvent.setup();
        renderWithProviders(<LfgHeartedPrompt />, {
            initialEntries: ['/games'],
        });
        await screen.findByTestId('lfg-hearted-prompt');
        await user.click(screen.getByLabelText("I'm up for Hearted Game 1"));
        return user;
    }

    it('asks WHEN instead of joining straight away', async () => {
        const posted = seedUrgencyJoin();
        await openChoice();

        const choice = await screen.findByTestId('lfg-urgency-choice');
        expect(
            within(choice)
                .getAllByRole('button')
                .map((b) => b.textContent),
        ).toEqual([
            LFG_COPY.urgencyWeek,
            LFG_COPY.urgencyNow30,
            LFG_COPY.urgencyNow60,
        ]);
        // The click that opened the choice must NOT have raised a hand — the
        // whole point of 1479 is that the horizon is the user's call.
        expect(posted).toHaveLength(0);
    });

    it('posts a 30-minute now intent when "Right now · 30 min" is picked', async () => {
        const posted = seedUrgencyJoin();
        const user = await openChoice();

        await user.click(
            await screen.findByRole('button', {
                name: LFG_COPY.urgencyNow30,
            }),
        );

        await waitFor(() => expect(posted).toHaveLength(1));
        expect(posted[0]).toEqual({
            gameId: 1,
            urgency: 'now',
            ttlMinutes: 30,
        });
    });

    it('posts a 60-minute now intent when "Right now · 1 hour" is picked', async () => {
        const posted = seedUrgencyJoin();
        const user = await openChoice();

        await user.click(
            await screen.findByRole('button', {
                name: LFG_COPY.urgencyNow60,
            }),
        );

        await waitFor(() => expect(posted).toHaveLength(1));
        expect(posted[0]).toEqual({
            gameId: 1,
            urgency: 'now',
            ttlMinutes: 60,
        });
    });

    it('posts a weekly intent with NO ttlMinutes key when "This week" is picked', async () => {
        // A2: the contract REJECTS `{ urgency: 'week', ttlMinutes }` with a
        // 400 rather than dropping the TTL, so a week request that carries the
        // key at all is a client bug — assert on the key set, not just the
        // value, because `{ ttlMinutes: undefined }` survives `toEqual`.
        const posted = seedUrgencyJoin();
        const user = await openChoice();

        await user.click(
            await screen.findByRole('button', { name: LFG_COPY.urgencyWeek }),
        );

        await waitFor(() => expect(posted).toHaveLength(1));
        expect(posted[0]).toEqual({ gameId: 1, urgency: 'week' });
        expect(Object.keys(posted[0])).not.toContain('ttlMinutes');
    });

    it('closes the choice once a horizon is picked', async () => {
        seedUrgencyJoin();
        const user = await openChoice();

        await user.click(
            await screen.findByRole('button', { name: LFG_COPY.urgencyWeek }),
        );

        await waitFor(() => {
            expect(
                screen.queryByTestId('lfg-urgency-choice'),
            ).not.toBeInTheDocument();
        });
    });
});

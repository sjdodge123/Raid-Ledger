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
import { server } from '../../test/mocks/server';
import { lfgHeartedHandler } from '../../test/mocks/lfg-handlers';
import {
    buildLfgHeartedGame,
    buildLfgIntentResponse,
} from '../../test/factories/lfg';
import { ACCESS_TOKEN_KEY } from '../../lib/api/auth-storage-keys';
import { renderWithProviders } from '../../test/render-helpers';
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

beforeEach(() => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'test-token');
    sessionStorage.clear();
});

describe('LfgHeartedPrompt — visibility', () => {
    it('renders nothing when the caller has no eligible hearts', async () => {
        renderPrompt(0);

        await waitFor(() => {
            expect(
                screen.queryByTestId('lfg-hearted-prompt'),
            ).not.toBeInTheDocument();
        });
    });

    it('renders nothing when the session was already dismissed', async () => {
        sessionStorage.setItem(DISMISS_KEY, '1');
        renderPrompt(3);

        await waitFor(() => {
            expect(
                screen.queryByTestId('lfg-hearted-prompt'),
            ).not.toBeInTheDocument();
        });
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
    /** Capture POSTs and let the hearted list change between reads. */
    function seedJoin(remaining: number[] = []) {
        const posted: { gameId: number }[] = [];
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
                const body = (await request.json()) as { gameId: number };
                posted.push(body);
                return HttpResponse.json(buildLfgIntentResponse(body.gameId), {
                    status: 201,
                });
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

        await waitFor(() => expect(posted).toHaveLength(1));
        expect(posted[0]).toEqual({ gameId: 1 });
    });

    it('drops the game from the prompt and confirms, linking to the group', async () => {
        seedJoin([2]);
        const user = userEvent.setup();
        renderWithProviders(<LfgHeartedPrompt />, {
            initialEntries: ['/games'],
        });

        await screen.findByTestId('lfg-hearted-prompt');
        await user.click(screen.getByLabelText("I'm up for Hearted Game 1"));

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

        renderPrompt(3);
        await waitFor(() => {
            expect(
                screen.queryByTestId('lfg-hearted-prompt'),
            ).not.toBeInTheDocument();
        });
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

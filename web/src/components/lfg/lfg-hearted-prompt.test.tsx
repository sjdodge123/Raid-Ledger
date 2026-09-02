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
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { server } from '../../test/mocks/server';
import { lfgHeartedHandler } from '../../test/mocks/lfg-handlers';
import { buildLfgHeartedGame } from '../../test/factories/lfg';
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

    it('links each entry to its LFG page', async () => {
        renderPrompt(1);

        await screen.findByTestId('lfg-hearted-prompt');
        expect(
            screen.getByRole('link', { name: /Hearted Game 1/i }),
        ).toHaveAttribute('href', '/lfg/hearted-game-1');
    });

    it('does not reuse the tile-chip testid for its entries', async () => {
        renderPrompt(3);

        await screen.findByTestId('lfg-hearted-prompt');
        expect(screen.queryAllByTestId('lfg-chip')).toHaveLength(0);
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

    it('has no accessibility violations', async () => {
        const { container } = renderPrompt(3);

        await screen.findByTestId('lfg-hearted-prompt');
        expect(await axe(container)).toHaveNoViolations();
    });
});

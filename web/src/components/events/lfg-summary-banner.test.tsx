/**
 * ROK-1453 AC3 — the events-page aggregate banner.
 *
 * TDD: `./lfg-summary-banner` does not exist yet, so this file fails at
 * import. That is the intended pre-implementation failure.
 *
 * Contract pinned here (spec §Files → `lfg-summary-banner.tsx`, D6):
 *   • the count comes from `GET /lfg` (one row per game with a live intent) —
 *     driven through MSW, so the component may read it through whichever hook
 *     the implementer wires;
 *   • copy: `1 game has players looking` / `N games have players looking`;
 *   • the whole banner links to the filtered Library view `/games?lfg=1`;
 *   • an empty response renders NOTHING — no zero-height placeholder, because
 *     the events banner stack is already scrolled past on mobile
 *     (`game-detail.smoke.spec.ts:20-38`).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { server } from '../../test/mocks/server';
import { lfgGroupsHandler } from '../../test/mocks/lfg-handlers';
import { buildLfgGroupSummary } from '../../test/factories/lfg';
import type { LfgGroupSummaryFixture } from '../../test/factories/lfg';
import { ACCESS_TOKEN_KEY } from '../../lib/api/auth-storage-keys';
import { renderWithProviders } from '../../test/render-helpers';
import { LfgSummaryBanner } from './lfg-summary-banner';

/** N distinct groups — the banner only counts rows, so ids are enough. */
function groups(n: number) {
    return Array.from({ length: n }, (_, i) =>
        buildLfgGroupSummary({
            gameId: i + 1,
            gameName: `Game ${i + 1}`,
            gameSlug: `game-${i + 1}`,
        }),
    );
}

function renderBanner(count: number) {
    server.use(lfgGroupsHandler(groups(count)));
    return renderWithProviders(<LfgSummaryBanner />, {
        initialEntries: ['/events'],
    });
}

beforeEach(() => {
    // `GET /lfg` is jwt-gated, so the query is `enabled: !!token`.
    localStorage.setItem(ACCESS_TOKEN_KEY, 'test-token');
});

describe('LfgSummaryBanner', () => {
    it('renders nothing when no game has a live intent', async () => {
        renderBanner(0);

        // Give the query a chance to resolve before asserting absence.
        await waitFor(() => {
            expect(
                screen.queryByTestId('lfg-summary-banner'),
            ).not.toBeInTheDocument();
        });
        expect(screen.queryByText(/players looking/i)).not.toBeInTheDocument();
    });

    it('names the single game instead of counting it (ROK-1478 AC3)', async () => {
        // RETARGETED, not deleted. This case used to pin the aggregate copy
        // `1 game has players looking` for a one-game community. ROK-1478 AC3
        // replaces that dead end — the banner now names the game and links
        // straight at its group page — so the case is re-pointed at the copy
        // that ships and additionally asserts the superseded sentence is gone.
        renderBanner(1);

        const banner = await screen.findByTestId('lfg-summary-banner');
        expect(banner).toHaveTextContent('Game 1');
        expect(banner).not.toHaveTextContent('1 game has players looking');
    });

    it('uses the plural for more than one game', async () => {
        renderBanner(3);

        const banner = await screen.findByTestId('lfg-summary-banner');
        expect(banner).toHaveTextContent('3 games have players looking');
        expect(banner).not.toHaveTextContent('3 game has');
    });

    it('links to the filtered Library view', async () => {
        renderBanner(2);

        await screen.findByTestId('lfg-summary-banner');
        const link = screen.getByRole('link', { name: /players looking/i });
        expect(link).toHaveAttribute('href', '/games?lfg=1');
    });

    it('shares the box metrics of the sibling event banners', async () => {
        // Operator walk: the banner is a full-bleed strip like
        // `SchedulingBanner` / `StandalonePollBanner` (all three render OUTSIDE
        // the page's `max-w-7xl` container — `events-page.tsx:110-114`), so it
        // has to carry their exact box classes. It also must not push its CTA
        // to the far edge with `justify-between`, which is what made a
        // wide-screen banner read as two disconnected fragments.
        renderBanner(2);

        const banner = await screen.findByTestId('lfg-summary-banner');
        for (const cls of ['mx-4', 'mb-4', 'p-4', 'rounded-xl']) {
            expect(banner.className).toContain(cls);
        }
        expect(banner.className).not.toContain('justify-between');
    });

    it('has no accessibility violations', async () => {
        const { container } = renderBanner(2);

        await screen.findByTestId('lfg-summary-banner');
        expect(await axe(container)).toHaveNoViolations();
    });
});

// ---------------------------------------------------------------------------
// ROK-1478 AC3 — a two-click path from the events page to a group.
//
// With exactly one game looking, `/games?lfg=1` was a pointless middle step:
// the filtered Library showed one tile whose badge went where the banner could
// have gone directly. The banner now names that game and links at it. The 2+
// branch is deliberately untouched and is the regression net below.
// ---------------------------------------------------------------------------

/** One group, overridable — the single-game branch is the whole AC. */
function renderOne(overrides: Partial<LfgGroupSummaryFixture> = {}) {
    server.use(
        lfgGroupsHandler([
            buildLfgGroupSummary({
                gameId: 42,
                gameName: 'Hellcard',
                gameSlug: 'hellcard',
                activeCount: 1,
                state: 'lfg',
                viabilityThreshold: null,
                ...overrides,
            }),
        ]),
    );
    return renderWithProviders(<LfgSummaryBanner />, {
        initialEntries: ['/events'],
    });
}

describe('LfgSummaryBanner — exactly one game (ROK-1478 AC3)', () => {
    it('links straight to that game\'s group page', async () => {
        renderOne();

        const banner = await screen.findByTestId('lfg-summary-banner');
        expect(banner).toHaveAttribute('href', '/lfg/hellcard');
    });

    it('names the game, describes the group and says Join', async () => {
        renderOne();

        const banner = await screen.findByTestId('lfg-summary-banner');
        const text = (banner.textContent ?? '').replace(/\s+/g, ' ').trim();
        expect(text).toContain('Hellcard');
        expect(text).toContain('1 looking · needs 1 more');
        expect(text).toContain('Join →');
        expect(text).not.toContain('players looking');
    });

    it('derives "needs 3 more" from the shared chip copy, not a hardcoded 1', async () => {
        renderOne({ viabilityThreshold: 4 });

        const banner = await screen.findByTestId('lfg-summary-banner');
        expect(banner).toHaveTextContent('needs 3 more');
    });

    it('reads "N looking to play" for a group that is already viable (A4)', async () => {
        renderOne({ activeCount: 5, state: 'lfm', viabilityThreshold: 4 });

        const banner = await screen.findByTestId('lfg-summary-banner');
        const text = (banner.textContent ?? '').replace(/\s+/g, ' ').trim();
        expect(text).toContain('5 looking to play');
        expect(text).not.toContain('needs');
    });
});

describe('LfgSummaryBanner — two or more games stay aggregate (ROK-1478 AC3)', () => {
    it('keeps the aggregate copy and the filtered-Library link', async () => {
        // Regression net for the branch this story does NOT change — it is
        // what `lfg-chips.smoke.spec.ts:288-302` exercises in CI.
        renderBanner(2);

        const banner = await screen.findByTestId('lfg-summary-banner');
        expect(banner).toHaveAttribute('href', '/games?lfg=1');
        expect(banner).toHaveTextContent('2 games have players looking');
        expect(banner).toHaveTextContent('Browse them →');
        expect(banner).not.toHaveTextContent('Join →');
    });
});

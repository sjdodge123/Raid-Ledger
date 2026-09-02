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

    it('uses the singular for exactly one game', async () => {
        renderBanner(1);

        const banner = await screen.findByTestId('lfg-summary-banner');
        expect(banner).toHaveTextContent('1 game has players looking');
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

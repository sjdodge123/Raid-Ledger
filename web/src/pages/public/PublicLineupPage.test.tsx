/**
 * PublicLineupPage tests (ROK-1067).
 *
 * Validates the un-authed public view of a community lineup:
 *   - Mounts inside <MemoryRouter> with NO auth provider (asserting that
 *     the page does not depend on auth context).
 *   - Renders the title H1 plus "Made with Raid Ledger" footer.
 *   - Decision block is conditional on `status === 'decided'`.
 *   - 404 state shows fallback UI (NOT a redirect to /login).
 *
 * TDD gate (Step 2d): the page module + the `usePublicLineup` hook do
 * not exist yet — these tests fail at import time. The dev agent makes
 * them pass.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// ─── Hook mocks ────────────────────────────────────────────────────────────

interface PublicLineupPayload {
    title: string;
    description: string | null;
    status: 'building' | 'voting' | 'decided' | 'archived';
    decision: { gameName: string; coverUrl: string | null } | null;
    communityName: string;
}

let mockPublicLineupResult: {
    data: PublicLineupPayload | null;
    isLoading: boolean;
    error: { status?: number; message?: string } | null;
} = {
    data: null,
    isLoading: false,
    error: null,
};

vi.mock('../../hooks/use-lineups', () => ({
    usePublicLineup: () => mockPublicLineupResult,
}));

// Import after mocks so the page module pulls the mocked hook.
import { PublicLineupPage } from './PublicLineupPage';

// ─── Helpers ──────────────────────────────────────────────────────────────

function renderPage(slug = 'aBcDeFgHiJ12') {
    return render(
        <MemoryRouter initialEntries={[`/p/lineup/${slug}`]}>
            <Routes>
                <Route path="/p/lineup/:slug" element={<PublicLineupPage />} />
            </Routes>
        </MemoryRouter>,
    );
}

function makePayload(
    overrides: Partial<PublicLineupPayload> = {},
): PublicLineupPayload {
    return {
        title: 'Smoke Public Lineup',
        description: 'A test lineup',
        status: 'building',
        decision: null,
        communityName: 'Raid Ledger',
        ...overrides,
    };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('PublicLineupPage (ROK-1067)', () => {
    beforeEach(() => {
        mockPublicLineupResult = { data: null, isLoading: false, error: null };
    });

    it('renders without auth context — title H1 + footer visible', () => {
        mockPublicLineupResult = {
            data: makePayload({ title: 'Public Lineup Title' }),
            isLoading: false,
            error: null,
        };

        renderPage();

        const heading = screen.getByRole('heading', {
            level: 1,
            name: /Public Lineup Title/i,
        });
        expect(heading).toBeInTheDocument();
        expect(screen.getByText(/Made with Raid Ledger/i)).toBeInTheDocument();
    });

    it('hides the decision block while status === "building"', () => {
        mockPublicLineupResult = {
            data: makePayload({ status: 'building', decision: null }),
            isLoading: false,
            error: null,
        };
        renderPage();
        expect(
            screen.queryByTestId('public-lineup-decision'),
        ).not.toBeInTheDocument();
    });

    it('shows the decision block when status === "decided"', () => {
        mockPublicLineupResult = {
            data: makePayload({
                status: 'decided',
                decision: { gameName: 'Rocket League', coverUrl: null },
            }),
            isLoading: false,
            error: null,
        };
        renderPage();
        const decision = screen.getByTestId('public-lineup-decision');
        expect(decision).toBeInTheDocument();
        expect(decision).toHaveTextContent(/Rocket League/i);
    });

    it('renders 404 fallback UI when the query returns 404 (no login redirect)', () => {
        mockPublicLineupResult = {
            data: null,
            isLoading: false,
            error: { status: 404, message: 'Not found' },
        };
        renderPage('missing-slug-x');

        // Fallback copy. Page must NEVER redirect/route to login.
        expect(
            screen.getByText(/no longer available|not found/i),
        ).toBeInTheDocument();
        // No password input ever rendered.
        expect(
            document.querySelector('input[type="password"]'),
        ).toBeNull();
    });

    it('renders an error panel (not the 404 panel) for non-404 transient errors', () => {
        // Codex review finding: a 500/429/network error should not look
        // identical to a missing/disabled slug. The 404 panel says "no
        // longer available" which is wrong when the backend is just hiccuping.
        mockPublicLineupResult = {
            data: null,
            isLoading: false,
            error: { status: 500, message: 'Internal server error' },
        };
        renderPage();

        expect(screen.getByTestId('public-lineup-error')).toBeInTheDocument();
        expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
        expect(
            screen.queryByText(/no longer available/i),
        ).not.toBeInTheDocument();
    });
});

/**
 * ROK-1341: the public lineup page lives on the chromeless `/p/*` route. Its
 * own <main> containers must use min-h-dvh (not min-h-screen) so the themed
 * background covers the full mobile scroll area — otherwise the inner main
 * re-locks to one viewport height and reinstates the bottom-band gap that the
 * Layout-root fix addresses for the rest of the app.
 */
describe('Regression: ROK-1341 — public lineup page main uses min-h-dvh', () => {
    beforeEach(() => {
        mockPublicLineupResult = { data: null, isLoading: false, error: null };
    });

    it('content page <main> uses min-h-dvh and not min-h-screen', () => {
        mockPublicLineupResult = {
            data: makePayload({
                status: 'decided',
                decision: { gameName: 'Rocket League', coverUrl: null },
            }),
            isLoading: false,
            error: null,
        };
        const { container } = renderPage();
        const main = container.querySelector('main')!;
        expect(main.className).toContain('min-h-dvh');
        expect(main.className).not.toContain('min-h-screen');
    });

    it('not-found <main> uses min-h-dvh and not min-h-screen', () => {
        mockPublicLineupResult = { data: null, isLoading: false, error: { status: 404 } };
        const { container } = renderPage();
        const main = container.querySelector('main')!;
        expect(main.className).toContain('min-h-dvh');
        expect(main.className).not.toContain('min-h-screen');
    });
});

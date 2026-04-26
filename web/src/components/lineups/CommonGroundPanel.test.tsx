/**
 * Tests for CommonGroundPanel AI surface states (ROK-1114).
 *
 * Validates the inline indicators that replace the silently-missing AI
 * row that triggered the prod outage:
 *   - "AI suggestions loading…" while the suggestions query is pending.
 *   - "Suggestions temporarily unavailable" when the endpoint returns 503
 *     (no provider configured).
 *   - The Common Ground grid still renders alongside the unavailable
 *     message — AI failure must NOT block the rest of the panel.
 *
 * These tests assume `useCommonGroundState` exposes `aiIsLoading`,
 * `aiIsUnavailable`, and `aiIsError` and that `CommonGroundPanel` reads
 * them — both pieces are part of the ROK-1114 dev work.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse, delay } from 'msw';
import { CommonGroundPanel } from './CommonGroundPanel';
import { renderWithProviders } from '../../test/render-helpers';
import { server } from '../../test/mocks/server';
import { usePluginStore } from '../../stores/plugin-store';

// ROK-1114 round 3: the AI suggestions overlay (banner + ✨ AI badge
// blend) is now gated on the `ai` plugin being active. Seed it active
// for the existing AI-state assertions; the dedicated "feature off"
// suite below clears it.
beforeEach(() => {
    usePluginStore.getState().setActiveSlugs(['ai']);
});

afterEach(() => {
    usePluginStore.setState({ activeSlugs: new Set(), initialized: false });
});

const API_BASE = 'http://localhost:3000';

/** Active-lineups response with one building lineup so the panel mounts. */
function buildActiveLineups() {
    return [
        {
            id: 7,
            title: 'Test Lineup',
            status: 'building' as const,
            targetDate: null,
            entryCount: 0,
            totalVoters: 0,
            createdAt: '2026-04-25T00:00:00.000Z',
            visibility: 'public' as const,
        },
    ];
}

/** Common Ground response with one game so the grid renders. */
function buildCommonGroundResponse() {
    return {
        data: [
            {
                gameId: 42,
                gameName: 'Valheim',
                slug: 'valheim',
                coverUrl: null,
                ownerCount: 5,
                wishlistCount: 2,
                nonOwnerPrice: null,
                itadCurrentCut: null,
                itadCurrentShop: null,
                itadCurrentUrl: null,
                earlyAccess: false,
                itadTags: [],
                playerCount: { min: 1, max: 10 },
                score: 80,
            },
        ],
        meta: {
            total: 1,
            appliedWeights: {
                ownerWeight: 1,
                saleBonus: 0,
                fullPricePenalty: 0,
                tasteWeight: 0,
                socialWeight: 0,
                intensityWeight: 0,
            },
            activeLineupId: 7,
            nominatedCount: 0,
            maxNominations: 20,
        },
    };
}

describe('CommonGroundPanel — AI suggestion state surfacing (ROK-1114)', () => {
    it('renders the loading indicator while AI suggestions are pending', async () => {
        // Active lineup + Common Ground succeed; AI hangs so the loading
        // indicator stays visible long enough to assert.
        server.use(
            http.get(`${API_BASE}/lineups/active`, () =>
                HttpResponse.json(buildActiveLineups()),
            ),
            http.get(`${API_BASE}/lineups/common-ground`, () =>
                HttpResponse.json(buildCommonGroundResponse()),
            ),
            http.get(`${API_BASE}/lineups/:id/suggestions`, async () => {
                await delay('infinite');
                return HttpResponse.json({});
            }),
        );

        renderWithProviders(<CommonGroundPanel />);

        const indicator = await screen.findByText(/AI suggestions loading/i);
        expect(indicator).toBeInTheDocument();
    });

    it('renders "Suggestions temporarily unavailable" when AI returns 503', async () => {
        server.use(
            http.get(`${API_BASE}/lineups/active`, () =>
                HttpResponse.json(buildActiveLineups()),
            ),
            http.get(`${API_BASE}/lineups/common-ground`, () =>
                HttpResponse.json(buildCommonGroundResponse()),
            ),
            http.get(`${API_BASE}/lineups/:id/suggestions`, () =>
                HttpResponse.json(
                    { error: 'AI_PROVIDER_UNAVAILABLE' },
                    { status: 503 },
                ),
            ),
        );

        renderWithProviders(<CommonGroundPanel />);

        const message = await screen.findByText(
            /Suggestions temporarily unavailable/i,
        );
        expect(message).toBeInTheDocument();
    });

    it('keeps rendering the Common Ground grid when AI returns 503 (regression guard)', async () => {
        server.use(
            http.get(`${API_BASE}/lineups/active`, () =>
                HttpResponse.json(buildActiveLineups()),
            ),
            http.get(`${API_BASE}/lineups/common-ground`, () =>
                HttpResponse.json(buildCommonGroundResponse()),
            ),
            http.get(`${API_BASE}/lineups/:id/suggestions`, () =>
                HttpResponse.json(
                    { error: 'AI_PROVIDER_UNAVAILABLE' },
                    { status: 503 },
                ),
            ),
        );

        renderWithProviders(<CommonGroundPanel />);

        // The unavailable message must appear…
        await screen.findByText(/Suggestions temporarily unavailable/i);
        // …and the Common Ground game card must STILL be visible. AI
        // failure must not blank the grid.
        await waitFor(() => {
            expect(screen.getByText('Valheim')).toBeInTheDocument();
        });
    });
});

describe('CommonGroundPanel — AI feature gate (ROK-1114 round 3)', () => {
    it('keeps the grid but hides the AI status banner when the AI plugin is inactive', async () => {
        // Wipe the active-plugins set seeded by the suite-level beforeEach.
        usePluginStore.setState({ activeSlugs: new Set(), initialized: true });
        let suggestionsCalls = 0;
        server.use(
            http.get(`${API_BASE}/lineups/active`, () =>
                HttpResponse.json(buildActiveLineups()),
            ),
            http.get(`${API_BASE}/lineups/common-ground`, () =>
                HttpResponse.json(buildCommonGroundResponse()),
            ),
            http.get(`${API_BASE}/lineups/:id/suggestions`, () => {
                suggestionsCalls += 1;
                return HttpResponse.json(
                    { error: 'AI_PROVIDER_UNAVAILABLE' },
                    { status: 503 },
                );
            }),
        );

        renderWithProviders(<CommonGroundPanel />);

        await waitFor(() => {
            expect(screen.getByText('Valheim')).toBeInTheDocument();
        });
        // No AI status text in any form (loading/unavailable/error).
        expect(
            screen.queryByText(/Suggestions temporarily unavailable/i),
        ).not.toBeInTheDocument();
        expect(
            screen.queryByText(/AI suggestions loading/i),
        ).not.toBeInTheDocument();
        expect(
            screen.queryByText(/AI suggestions unavailable/i),
        ).not.toBeInTheDocument();
        // No fetch fired against the suggestions endpoint.
        expect(suggestionsCalls).toBe(0);
    });
});

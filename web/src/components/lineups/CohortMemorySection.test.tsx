/**
 * ROK-1309 — "Played with this group before" section.
 *
 * Covers the two ACs this slice closes:
 *  - "Web UI: new section rendered BELOW the Common Ground list ... Hidden
 *    when empty. Each card shows game art + last-resolved date + small badge
 *    for `decided` / `match` / `veto_won`."
 *  - "Nominate-from-memory: clicking a remembered card creates a regular
 *    `communityLineupEntries` row ... via the existing nominate mutation."
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { CohortMemorySection } from './CohortMemorySection';

const API_BASE = 'http://localhost:3000';
const LINEUP_ID = 42;

function entry(over: Record<string, unknown> = {}) {
    return {
        gameId: 101,
        gameName: 'Deep Rock Galactic',
        gameCoverUrl: 'https://cdn.example/drg.jpg',
        resolution: 'decided',
        lastResolvedAt: '2026-03-14T18:00:00.000Z',
        sourceLineupId: 7,
        ...over,
    };
}

function mockMemory(body: { cohortSize: number; entries: unknown[] }) {
    server.use(
        http.get(`${API_BASE}/lineups/${LINEUP_ID}/cohort-memory`, () =>
            HttpResponse.json(body),
        ),
    );
}

/** Captures the nominate POST body so the mutation call can be asserted. */
function captureNominate(calls: Array<{ gameId: number }>) {
    server.use(
        http.post(`${API_BASE}/lineups/${LINEUP_ID}/nominate`, async ({ request }) => {
            calls.push((await request.json()) as { gameId: number });
            return HttpResponse.json({ id: LINEUP_ID, entries: [] });
        }),
    );
}

describe('CohortMemorySection (ROK-1309)', () => {
    let nominateCalls: Array<{ gameId: number }>;

    beforeEach(() => {
        nominateCalls = [];
        captureNominate(nominateCalls);
    });

    it('renders nothing when the cohort has no remembered games', async () => {
        mockMemory({ cohortSize: 0, entries: [] });

        const { container } = renderWithProviders(
            <CohortMemorySection lineupId={LINEUP_ID} canParticipate />,
        );

        await waitFor(() => {
            expect(
                screen.queryByTestId('cohort-memory-section'),
            ).not.toBeInTheDocument();
        });
        expect(container).toBeEmptyDOMElement();
    });

    it('renders one card per entry with art, last-resolved date and badge', async () => {
        mockMemory({
            cohortSize: 3,
            entries: [
                entry(),
                entry({
                    gameId: 202,
                    gameName: 'Valheim',
                    gameCoverUrl: null,
                    resolution: 'match',
                    lastResolvedAt: '2026-02-01T12:00:00.000Z',
                }),
                entry({
                    gameId: 303,
                    gameName: 'Barotrauma',
                    resolution: 'veto_won',
                    lastResolvedAt: '2026-01-09T12:00:00.000Z',
                }),
            ],
        });

        renderWithProviders(
            <CohortMemorySection lineupId={LINEUP_ID} canParticipate />,
        );

        expect(
            await screen.findByTestId('cohort-memory-section'),
        ).toBeInTheDocument();
        expect(await screen.findAllByTestId(/^cohort-memory-card-/)).toHaveLength(3);

        // Game art — cover when present, placeholder when null.
        expect(screen.getByAltText('Deep Rock Galactic')).toHaveAttribute(
            'src',
            'https://cdn.example/drg.jpg',
        );
        expect(screen.queryByAltText('Valheim')).not.toBeInTheDocument();

        // Badges — one per resolution kind.
        expect(screen.getByText('Decided')).toBeInTheDocument();
        expect(screen.getByText('Match')).toBeInTheDocument();
        expect(screen.getByText('Veto won')).toBeInTheDocument();

        // Last-resolved date, machine-readable on the <time> element.
        const stamps = screen.getAllByTestId('cohort-memory-resolved-at');
        expect(stamps).toHaveLength(3);
        expect(stamps[0]).toHaveAttribute('datetime', '2026-03-14T18:00:00.000Z');
        expect(stamps[0].textContent).toMatch(/2026/);
    });

    it('nominates the clicked game through the existing nominate mutation', async () => {
        mockMemory({
            cohortSize: 3,
            entries: [entry(), entry({ gameId: 202, gameName: 'Valheim' })],
        });

        renderWithProviders(
            <CohortMemorySection lineupId={LINEUP_ID} canParticipate />,
        );

        const card = await screen.findByTestId('cohort-memory-card-202');
        await userEvent.click(card);

        await waitFor(() => {
            expect(nominateCalls).toEqual([{ gameId: 202 }]);
        });
    });

    it('never surfaces a veto_lost game (API filters; UI does not resurrect)', async () => {
        // The endpoint filters `veto_lost` server-side, so the payload only
        // carries the positive outcomes. The section must render exactly that
        // set — no client-side re-derivation that could bring a loser back.
        mockMemory({
            cohortSize: 3,
            entries: [entry({ gameId: 101, gameName: 'Deep Rock Galactic' })],
        });

        renderWithProviders(
            <CohortMemorySection lineupId={LINEUP_ID} canParticipate />,
        );

        expect(
            await screen.findByTestId('cohort-memory-card-101'),
        ).toBeInTheDocument();
        expect(screen.getAllByTestId(/^cohort-memory-card-/)).toHaveLength(1);
        // "Rejected by this group" (the veto loser) is not part of this story.
        expect(screen.queryByText(/veto lost/i)).not.toBeInTheDocument();
        expect(screen.queryByText('Rejected')).not.toBeInTheDocument();
    });
});

/**
 * CohortFrequencyPanel.test.tsx (ROK-1310 S7)
 *
 * Pins the AC surface of the "Most-matched games by group size" panel:
 *  1. buckets + ranked rows render from a seeded MSW response,
 *  2. the Matched/Rejected toggle swaps BOTH the issued query and the rows,
 *  3. an empty `buckets: []` payload renders the exact AC empty-state copy.
 *
 * The endpoint is a live read (never 503 no_snapshot_yet), so the empty state
 * is driven by an empty 200 payload — not by NoSnapshotYetError.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import type { CohortGameFrequencyResponseDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../test/render-helpers';
import { server } from '../../../test/mocks/server';
import { CohortFrequencyPanel } from './CohortFrequencyPanel';

const API = 'http://localhost:3000';

const matchedFixture: CohortGameFrequencyResponseDto = {
    mode: 'matched',
    topN: 5,
    buckets: [
        {
            bucket: '2',
            entries: [
                {
                    rank: 1,
                    gameId: 11,
                    gameName: 'Hades',
                    gameCoverUrl: 'https://cdn.example/hades.jpg',
                    count: 4,
                    breakdown: { decided: 2, match: 1, vetoWon: 1, vetoLost: 0 },
                },
                {
                    rank: 2,
                    gameId: 12,
                    gameName: 'Stardew Valley',
                    gameCoverUrl: null,
                    count: 2,
                    breakdown: { decided: 2, match: 0, vetoWon: 0, vetoLost: 0 },
                },
            ],
        },
        {
            bucket: '6+',
            entries: [
                {
                    rank: 1,
                    gameId: 13,
                    gameName: 'Deep Rock Galactic',
                    gameCoverUrl: null,
                    count: 7,
                    breakdown: { decided: 3, match: 4, vetoWon: 0, vetoLost: 0 },
                },
            ],
        },
    ],
};

const rejectedFixture: CohortGameFrequencyResponseDto = {
    mode: 'rejected',
    topN: 5,
    buckets: [
        {
            bucket: '3',
            entries: [
                {
                    rank: 1,
                    gameId: 21,
                    gameName: 'Escape From Tarkov',
                    gameCoverUrl: null,
                    count: 3,
                    breakdown: { decided: 0, match: 0, vetoWon: 0, vetoLost: 3 },
                },
            ],
        },
    ],
};

const requestedModes: string[] = [];

function seed(byMode: (mode: string) => CohortGameFrequencyResponseDto) {
    server.use(
        http.get(`${API}/insights/community/cohort-game-frequency`, ({ request }) => {
            const mode = new URL(request.url).searchParams.get('mode') ?? 'matched';
            requestedModes.push(mode);
            return HttpResponse.json(byMode(mode));
        }),
    );
}

beforeEach(() => {
    requestedModes.length = 0;
});

describe('CohortFrequencyPanel (ROK-1310)', () => {
    it('renders each bucket with its ranked rows, cover, count and breakdown', async () => {
        seed(() => matchedFixture);
        renderWithProviders(<CohortFrequencyPanel />);

        expect(screen.getByTestId('community-insights-cohort-frequency')).toBeInTheDocument();

        const firstRow = await screen.findByTestId('cohort-row-2-11');
        expect(firstRow).toHaveTextContent('Hades');
        expect(firstRow).toHaveTextContent('1');
        expect(firstRow).toHaveTextContent('4');
        // breakdown badge — decided / match / veto-won split behind the count
        expect(firstRow).toHaveTextContent(/2 decided/i);
        expect(firstRow).toHaveTextContent(/1 match/i);
        expect(firstRow).toHaveTextContent(/1 veto/i);

        const cover = firstRow.querySelector('img');
        expect(cover).toHaveAttribute('src', 'https://cdn.example/hades.jpg');

        expect(screen.getByTestId('cohort-bucket-2')).toBeInTheDocument();
        expect(screen.getByTestId('cohort-bucket-6+')).toBeInTheDocument();
        expect(screen.getByTestId('cohort-row-2-12')).toHaveTextContent('Stardew Valley');
        expect(screen.getByTestId('cohort-row-6+-13')).toHaveTextContent('Deep Rock Galactic');

        // Defaults to the Matched view.
        expect(requestedModes).toEqual(['matched']);
    });

    it('toggling to Rejected re-queries with mode=rejected and swaps the rendered rows', async () => {
        seed((mode) => (mode === 'rejected' ? rejectedFixture : matchedFixture));
        renderWithProviders(<CohortFrequencyPanel />);

        await screen.findByTestId('cohort-row-2-11');

        fireEvent.click(screen.getByRole('button', { name: /rejected/i }));

        // The request actually changed…
        await waitFor(() => expect(requestedModes).toContain('rejected'));
        // …and so did the table.
        await waitFor(() =>
            expect(screen.getByTestId('cohort-row-3-21')).toHaveTextContent('Escape From Tarkov'),
        );
        expect(screen.queryByTestId('cohort-row-2-11')).not.toBeInTheDocument();
        expect(screen.queryByText('Hades')).not.toBeInTheDocument();
    });

    it('renders the AC empty-state copy when the payload has no buckets', async () => {
        seed((mode) => ({ mode: mode as 'matched', topN: 5, buckets: [] }));
        renderWithProviders(<CohortFrequencyPanel />);

        expect(
            await screen.findByText('No cohort data yet — needs decided lineups to populate.'),
        ).toBeInTheDocument();
    });
});

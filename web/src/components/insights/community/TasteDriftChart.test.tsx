import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TasteDriftChart } from './TasteDriftChart';
import { reshape } from './taste-drift-helpers';

describe('TasteDriftChart', () => {
    it('renders empty state when no drift series is provided', () => {
        render(<TasteDriftChart driftSeries={[]} />);
        expect(screen.getByText(/not enough history/i)).toBeInTheDocument();
    });

    it('renders chart for populated series', () => {
        render(
            <TasteDriftChart
                driftSeries={[
                    { weekStart: '2026-03-01', axis: 'rpg', meanScore: 50 },
                    { weekStart: '2026-03-08', axis: 'rpg', meanScore: 60 },
                ]}
            />,
        );
        expect(screen.getByTestId('taste-drift-chart')).toBeInTheDocument();
    });
});

describe('TasteDriftChart reshape()', () => {
    it('collapses to a single week when only one weekStart is present', () => {
        const result = reshape([
            { weekStart: '2026-05-04', axis: 'rpg', meanScore: 42 },
            { weekStart: '2026-05-04', axis: 'co_op', meanScore: 35 },
        ]);
        expect(result.weeks).toEqual(['2026-05-04']);
        expect(result.rows).toHaveLength(1);
    });

    it('sorts weeks ascending and rounds meanScore', () => {
        const result = reshape([
            { weekStart: '2026-05-04', axis: 'rpg', meanScore: 42.7 },
            { weekStart: '2026-04-20', axis: 'rpg', meanScore: 30.2 },
            { weekStart: '2026-04-27', axis: 'rpg', meanScore: 36.6 },
        ]);
        expect(result.weeks).toEqual(['2026-04-20', '2026-04-27', '2026-05-04']);
        expect(result.rows.map((r) => r.rpg)).toEqual([30, 37, 43]);
    });

    it('picks top-3 axes by latest-week meanScore', () => {
        const latest = '2026-05-04';
        const result = reshape([
            { weekStart: latest, axis: 'rpg', meanScore: 90 },
            { weekStart: latest, axis: 'co_op', meanScore: 70 },
            { weekStart: latest, axis: 'pvp', meanScore: 50 },
            { weekStart: latest, axis: 'survival', meanScore: 10 },
        ]);
        expect(result.topAxes).toEqual(['rpg', 'co_op', 'pvp']);
    });

    it('fills missing weekly samples with 0 for the selected axes', () => {
        const result = reshape([
            { weekStart: '2026-04-20', axis: 'rpg', meanScore: 30 },
            // 2026-04-27 has no rpg sample
            { weekStart: '2026-04-27', axis: 'co_op', meanScore: 25 },
            { weekStart: '2026-05-04', axis: 'rpg', meanScore: 60 },
            { weekStart: '2026-05-04', axis: 'co_op', meanScore: 50 },
        ]);
        expect(result.topAxes).toEqual(['rpg', 'co_op']);
        // Middle row missing rpg sample → falls back to 0
        expect(result.rows[1].rpg).toBe(0);
        expect(result.rows[1].co_op).toBe(25);
    });
});

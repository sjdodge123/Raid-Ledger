import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TasteDriftChart } from './TasteDriftChart';

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

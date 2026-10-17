import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TemporalHeatmap } from './TemporalHeatmap';

describe('TemporalHeatmap', () => {
    it('renders empty state for no data', () => {
        render(<TemporalHeatmap heatmap={[]} />);
        expect(screen.getByText(/not enough temporal/i)).toBeInTheDocument();
    });

    it('renders a 7x24 grid of focusable cells with aria-labels', () => {
        render(
            <TemporalHeatmap
                heatmap={[
                    { weekday: 1, hour: 20, activity: 12 },
                    { weekday: 5, hour: 22, activity: 4 },
                ]}
            />,
        );
        expect(screen.getByTestId('temporal-heatmap')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Mon, 20:00 — 12 sessions/i })).toBeInTheDocument();
    });
});

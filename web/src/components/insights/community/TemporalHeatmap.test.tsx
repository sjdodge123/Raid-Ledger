import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TemporalHeatmap } from './TemporalHeatmap';
import { sessionsLabel } from './temporal-heatmap.utils';

describe('TemporalHeatmap', () => {
    it('renders empty state for no data', () => {
        render(<TemporalHeatmap heatmap={[]} peakHours={[]} />);
        expect(screen.getByText(/not enough temporal/i)).toBeInTheDocument();
    });

    it('renders a 7x24 grid of focusable cells with aria-labels', () => {
        render(
            <TemporalHeatmap
                heatmap={[
                    { weekday: 1, hour: 20, activity: 12 },
                    { weekday: 5, hour: 22, activity: 4 },
                ]}
                peakHours={[]}
            />,
        );
        expect(screen.getByTestId('temporal-heatmap')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Mon, 20:00 — 12 sessions/i })).toBeInTheDocument();
    });

    it('says "1 session" for a single session and "N sessions" otherwise', () => {
        expect(sessionsLabel(1)).toBe('1 session');
        expect(sessionsLabel(0)).toBe('0 sessions');
        expect(sessionsLabel(17)).toBe('17 sessions');
    });

    describe('peak hours on the heatmap (ROK-1936)', () => {
        const heatmap = [
            { weekday: 6, hour: 21, activity: 17 },
            { weekday: 6, hour: 14, activity: 3 },
            { weekday: 1, hour: 0, activity: 5 },
            { weekday: 7, hour: 12, activity: 9 },
        ];
        const peakHours = [
            { weekday: 6, hour: 21, activity: 17 },
            { weekday: 1, hour: 0, activity: 5 },
            { weekday: 7, hour: 12, activity: 9 },
        ];

        it('marks a peak cell and labels it "Sat 9pm · 17 sessions"', () => {
            render(<TemporalHeatmap heatmap={heatmap} peakHours={peakHours} />);
            const cell = screen.getByRole('button', { name: /^Sat 9pm · 17 sessions/ });
            expect(cell).toHaveAttribute('data-peak', 'true');
            expect(cell).toHaveAttribute('title', 'Sat 9pm · 17 sessions');
        });

        it('formats midnight as 12am and noon as 12pm', () => {
            render(<TemporalHeatmap heatmap={heatmap} peakHours={peakHours} />);
            expect(screen.getByTitle('Mon 12am · 5 sessions')).toHaveAttribute('data-peak', 'true');
            expect(screen.getByTitle('Sun 12pm · 9 sessions')).toHaveAttribute('data-peak', 'true');
        });

        it('leaves non-peak cells unmarked with their existing label', () => {
            render(<TemporalHeatmap heatmap={heatmap} peakHours={peakHours} />);
            const cell = screen.getByRole('button', { name: 'Sat, 14:00 — 3 sessions' });
            expect(cell).not.toHaveAttribute('data-peak');
            expect(cell).not.toHaveAttribute('title');
        });

        it('marks exactly one cell per peak entry', () => {
            const { container } = render(<TemporalHeatmap heatmap={heatmap} peakHours={peakHours} />);
            expect(container.querySelectorAll('[data-peak="true"]')).toHaveLength(peakHours.length);
        });
    });
});

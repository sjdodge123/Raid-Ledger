import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { SpeedGauge } from './SpeedGauge';
import { gaugeFraction, formatMbps } from './speed-gauge.helpers';

describe('gaugeFraction', () => {
    it('is empty at zero, gives the first megabit a sixth of the sweep, and pins 100+ to the end', () => {
        expect(gaugeFraction(null)).toBe(0);
        expect(gaugeFraction(0)).toBe(0);
        expect(gaugeFraction(0.5)).toBeCloseTo(1 / 12, 5);
        expect(gaugeFraction(1)).toBeCloseTo(1 / 6, 5);
        expect(gaugeFraction(10)).toBeCloseTo(1 / 6 + (5 / 6) * 0.5, 5);
        expect(gaugeFraction(100)).toBe(1);
        expect(gaugeFraction(478.5)).toBe(1);
    });

    it('is monotonic across the whole scale', () => {
        const samples = [0, 0.2, 1, 2, 5, 10, 20, 50, 99, 100, 1000];
        const fractions = samples.map(gaugeFraction);
        for (let i = 1; i < fractions.length; i += 1) {
            expect(fractions[i]).toBeGreaterThanOrEqual(fractions[i - 1]);
        }
    });
});

describe('SpeedGauge', () => {
    it('shows a dash before the first sample and the live figure after it', () => {
        const { rerender } = render(<SpeedGauge mbps={null} caption="Testing download…" />);
        expect(screen.getByTestId('speed-gauge-value')).toHaveTextContent('—');
        expect(screen.getByTestId('speed-gauge-fill')).toHaveAttribute('data-fraction', '0.000');
        rerender(<SpeedGauge mbps={478.5} caption="Testing download…" />);
        expect(screen.getByTestId('speed-gauge-value')).toHaveTextContent('478.5');
        expect(screen.getByTestId('speed-gauge-fill')).toHaveAttribute('data-fraction', '1.000');
        expect(formatMbps(12.345)).toBe('12.3');
    });

    it('labels the scale 0 · 1 · 5 · 10 · 20 · 50 · 100+ and names the figure for assistive tech', async () => {
        const { container } = render(<SpeedGauge mbps={42.25} caption="Testing download…" />);
        for (const label of ['0', '1', '5', '10', '20', '50', '100+']) {
            expect(screen.getByText(label)).toBeInTheDocument();
        }
        expect(screen.getByRole('img')).toHaveAccessibleName(/Download speed 42\.3 megabits per second, Testing download…/);
        expect(await axe(container)).toHaveNoViolations();
    });
});

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PeakHoursChart } from './PeakHoursChart';

describe('PeakHoursChart', () => {
    it('renders empty state for no data', () => {
        render(<PeakHoursChart peakHours={[]} />);
        expect(screen.getByText(/not enough peak-hour/i)).toBeInTheDocument();
    });

    it('renders chart for populated data', () => {
        render(
            <PeakHoursChart
                peakHours={[
                    { weekday: 1, hour: 20, activity: 10 },
                    { weekday: 1, hour: 21, activity: 8 },
                    { weekday: 2, hour: 19, activity: 5 },
                ]}
            />,
        );
        expect(screen.getByTestId('peak-hours-chart')).toBeInTheDocument();
    });
});

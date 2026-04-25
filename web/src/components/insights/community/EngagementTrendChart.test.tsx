import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EngagementTrendChart } from './EngagementTrendChart';

describe('EngagementTrendChart', () => {
    it('renders empty state for no data', () => {
        render(<EngagementTrendChart weeklyActiveUsers={[]} />);
        expect(screen.getByText(/not enough activity/i)).toBeInTheDocument();
    });

    it('renders chart for populated data', () => {
        render(
            <EngagementTrendChart
                weeklyActiveUsers={[
                    { weekStart: '2026-03-01', activeUsers: 10 },
                    { weekStart: '2026-03-08', activeUsers: 14 },
                ]}
            />,
        );
        expect(screen.getByTestId('engagement-trend')).toBeInTheDocument();
    });
});

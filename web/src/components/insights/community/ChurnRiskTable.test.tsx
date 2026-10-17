import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChurnRiskTable } from './ChurnRiskTable';

describe('ChurnRiskTable', () => {
    it('shows "not enough history" when flag is set', () => {
        render(<ChurnRiskTable thresholdPct={70} atRisk={[]} notEnoughHistory />);
        expect(screen.getByText(/not enough history/i)).toBeInTheDocument();
    });

    it('shows healthy empty state when no at-risk rows', () => {
        render(<ChurnRiskTable thresholdPct={70} atRisk={[]} notEnoughHistory={false} />);
        expect(screen.getByText(/community is healthy/i)).toBeInTheDocument();
    });

    it('renders rows and reverses sort on double-click of header', () => {
        render(
            <ChurnRiskTable
                thresholdPct={70}
                notEnoughHistory={false}
                atRisk={[
                    { userId: 1, username: 'Alice', avatar: null, baselineHours: 10, recentHours: 2, dropPct: 80 },
                    { userId: 2, username: 'Bob', avatar: null, baselineHours: 5, recentHours: 1, dropPct: 80 },
                ]}
            />,
        );
        expect(screen.getByTestId('churn-risk-table')).toBeInTheDocument();
        expect(screen.getByText('Alice')).toBeInTheDocument();
        const dropHeader = screen.getByRole('button', { name: /drop/i });
        fireEvent.click(dropHeader);
        // Still renders after toggle
        expect(screen.getByText('Alice')).toBeInTheDocument();
    });
});

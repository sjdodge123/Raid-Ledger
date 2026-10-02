/**
 * my-events-page-heading.test.tsx (ROK-1128 #7)
 *
 * MyEventsPage renders inside the Insights hub's <h1>Insights</h1> (via the
 * Events tab), so its "Event Metrics" title must be an h2 — on both the
 * empty-state branch and the main dashboard branch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-helpers';
import { MyEventsPage } from '../my-events-page';

const dashboardState = vi.hoisted(() => ({
    value: { isLoading: false, error: null, data: { events: [] } } as Record<string, unknown>,
}));

vi.mock('../../hooks/use-my-events', () => ({
    useMyDashboard: () => dashboardState.value,
}));

vi.mock('../../hooks/use-auth', async (orig) => {
    const actual = await orig<typeof import('../../hooks/use-auth')>();
    return {
        ...actual,
        useAuth: () => ({
            user: { id: 1, username: 'stub', role: 'member' },
            isAuthenticated: true,
            isLoading: false,
            error: null,
            refetch: () => Promise.resolve(),
        }),
    };
});

function expectEventMetricsIsH2() {
    expect(screen.getByRole('heading', { name: 'Event Metrics' }).tagName).toBe('H2');
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
}

describe('MyEventsPage heading level', () => {
    beforeEach(() => {
        dashboardState.value = { isLoading: false, error: null, data: { events: [] } };
    });

    it('renders "Event Metrics" as an h2 on the empty state', () => {
        renderWithProviders(<MyEventsPage />);
        expect(screen.getByText(/don't have any upcoming events/i)).toBeInTheDocument();
        expectEventMetricsIsH2();
    });

    it('renders "Event Metrics" as an h2 on the dashboard branch', () => {
        dashboardState.value = { isLoading: true, error: null, data: undefined };
        renderWithProviders(<MyEventsPage />);
        expect(screen.queryByText(/don't have any upcoming events/i)).not.toBeInTheDocument();
        expectEventMetricsIsH2();
    });
});

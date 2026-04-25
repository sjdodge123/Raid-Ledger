/**
 * insights-hub-page.test.tsx (ROK-1099)
 *
 * Asserts role-gated rendering of the /insights hub:
 *   - admin/operator see Community + Events tabs
 *   - member sees only the Events tab
 *   - member landing on /insights/community is redirected to /insights/events
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '../../test/render-helpers';
import { InsightsHubPage } from '../insights-hub-page';

type Role = 'admin' | 'operator' | 'member';

const authState = vi.hoisted(() => ({
    role: 'admin' as Role,
}));

vi.mock('../../hooks/use-auth', async (orig) => {
    const actual = await orig<typeof import('../../hooks/use-auth')>();
    return {
        ...actual,
        useAuth: () => ({
            user: { id: 1, username: 'stub', role: authState.role },
            isAuthenticated: true,
            isLoading: false,
            error: null,
            refetch: () => Promise.resolve(),
        }),
    };
});

function renderHub(path: string) {
    return renderWithProviders(
        <Routes>
            <Route path="/insights" element={<InsightsHubPage />}>
                <Route path="community" element={<div data-testid="stub-community">community</div>} />
                <Route path="events" element={<div data-testid="stub-events">events</div>} />
            </Route>
        </Routes>,
        { initialEntries: [path] },
    );
}

describe('InsightsHubPage (ROK-1099)', () => {
    beforeEach(() => {
        authState.role = 'admin';
    });

    it('renders insights-hub testid for an admin', () => {
        renderHub('/insights/community');
        expect(screen.getByTestId('insights-hub')).toBeInTheDocument();
    });

    it('shows both tab labels for admin', () => {
        renderHub('/insights/community');
        expect(screen.getByRole('link', { name: 'Community' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Events' })).toBeInTheDocument();
        expect(screen.queryByText('Trends')).not.toBeInTheDocument();
    });

    it('shows both tab labels for operator', () => {
        authState.role = 'operator';
        renderHub('/insights/community');
        expect(screen.getByRole('link', { name: 'Community' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Events' })).toBeInTheDocument();
        expect(screen.queryByText('Trends')).not.toBeInTheDocument();
    });

    it('hides the Community tab for a member', () => {
        authState.role = 'member';
        renderHub('/insights/events');
        expect(screen.getByRole('link', { name: 'Events' })).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Community' })).not.toBeInTheDocument();
    });

    it('redirects a member who lands on /insights/community to /insights/events', () => {
        authState.role = 'member';
        renderHub('/insights/community');
        expect(screen.getByTestId('stub-events')).toBeInTheDocument();
        expect(screen.queryByTestId('stub-community')).not.toBeInTheDocument();
    });
});

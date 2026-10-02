/**
 * Header for a signed-in member (ROK-1099 / ROK-1128): the Insights entry
 * replaces the old "Event Metrics" nav link. Lives in its own file because
 * Header.test.tsx pins `useAuth` to a logged-out user with a module-scope mock.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Header } from './Header';
import { at } from '../../test/defined';

vi.mock('../../hooks/use-auth', () => ({
    useAuth: () => ({
        user: { id: 1, username: 'TestUser', role: 'member' },
        isAuthenticated: true,
    }),
}));

vi.mock('../../hooks/use-system-status', () => ({
    useSystemStatus: () => ({ data: null }),
}));

vi.mock('../../hooks/use-scroll-direction', () => ({
    useScrollDirection: () => 'up',
}));

vi.mock('../../lib/config', () => ({
    API_BASE_URL: 'http://localhost:3000',
}));

vi.mock('../notifications', () => ({
    NotificationBell: () => null,
}));

vi.mock('./ThemeToggle', () => ({
    ThemeToggle: () => null,
}));

vi.mock('./UserMenu', () => ({
    UserMenu: () => null,
}));

function renderHeader() {
    return render(
        <MemoryRouter>
            <Header onMenuClick={vi.fn()} />
        </MemoryRouter>,
    );
}

describe('Header — authenticated member', () => {
    it('links to /insights from the desktop nav and the screen-reader mobile link', () => {
        renderHeader();
        const insights = screen.getAllByRole('link', { name: 'Insights' });
        expect(insights).toHaveLength(2);
        for (const link of insights) expect(link).toHaveAttribute('href', '/insights');
        const nav = screen.getByRole('navigation', { name: 'Main navigation' });
        expect(nav).toContainElement(at(insights, 0));
    });

    it('has no "Event Metrics" link', () => {
        renderHeader();
        expect(screen.queryByRole('link', { name: /event metrics/i })).not.toBeInTheDocument();
    });
});

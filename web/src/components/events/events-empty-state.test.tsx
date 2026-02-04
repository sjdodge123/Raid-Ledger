import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { EventsEmptyState } from './events-empty-state';
import * as useAuthModule from '../../hooks/use-auth';

// Mock useAuth hook
vi.mock('../../hooks/use-auth', () => ({
    useAuth: vi.fn(() => ({ isAuthenticated: true, user: null, isLoading: false })),
}));

const renderWithRouter = (component: React.ReactNode) => {
    return render(<BrowserRouter>{component}</BrowserRouter>);
};

describe('EventsEmptyState', () => {
    beforeEach(() => {
        // Reset mock to authenticated state before each test
        vi.mocked(useAuthModule.useAuth).mockReturnValue({
            isAuthenticated: true,
            user: null,
            isLoading: false,
        } as ReturnType<typeof useAuthModule.useAuth>);
    });

    it('renders empty state message', () => {
        renderWithRouter(<EventsEmptyState />);
        expect(screen.getByText('No events yet')).toBeInTheDocument();
    });

    it('renders descriptive text', () => {
        renderWithRouter(<EventsEmptyState />);
        expect(screen.getByText(/Be the first to create an event/)).toBeInTheDocument();
    });

    it('renders create event CTA link when authenticated', () => {
        renderWithRouter(<EventsEmptyState />);
        const link = screen.getByRole('link', { name: /Create Your First Event/i });
        expect(link).toBeInTheDocument();
        expect(link).toHaveAttribute('href', '/events/new');
    });

    it('renders sign in message when not authenticated', () => {
        vi.mocked(useAuthModule.useAuth).mockReturnValue({
            isAuthenticated: false,
            user: null,
            isLoading: false,
        } as ReturnType<typeof useAuthModule.useAuth>);

        renderWithRouter(<EventsEmptyState />);
        expect(screen.getByText('Sign in to create events')).toBeInTheDocument();
    });
});


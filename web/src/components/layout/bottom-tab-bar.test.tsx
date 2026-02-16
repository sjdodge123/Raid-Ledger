import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BottomTabBar } from './bottom-tab-bar';

function renderWithRouter(ui: React.ReactElement, { route = '/' } = {}) {
    return render(<MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>);
}

describe('BottomTabBar', () => {
    it('renders 4 tab links', () => {
        renderWithRouter(<BottomTabBar />);
        expect(screen.getByText('Calendar')).toBeInTheDocument();
        expect(screen.getByText('Events')).toBeInTheDocument();
        expect(screen.getByText('Games')).toBeInTheDocument();
        expect(screen.getByText('Players')).toBeInTheDocument();
    });

    it('highlights the active tab with emerald color', () => {
        renderWithRouter(<BottomTabBar />, { route: '/events' });
        const eventsLink = screen.getByText('Events').closest('a')!;
        expect(eventsLink.className).toContain('text-emerald-400');

        const calendarLink = screen.getByText('Calendar').closest('a')!;
        expect(calendarLink.className).not.toContain('text-emerald-400');
    });

    it('renders active indicator bar for the active tab', () => {
        renderWithRouter(<BottomTabBar />, { route: '/calendar' });
        const calendarLink = screen.getByText('Calendar').closest('a')!;
        const indicator = calendarLink.querySelector('.bg-emerald-400');
        expect(indicator).toBeInTheDocument();
    });

    it('does not render active indicator for inactive tabs', () => {
        renderWithRouter(<BottomTabBar />, { route: '/calendar' });
        const eventsLink = screen.getByText('Events').closest('a')!;
        const indicator = eventsLink.querySelector('.bg-emerald-400');
        expect(indicator).not.toBeInTheDocument();
    });

    it('has md:hidden class for mobile-only visibility', () => {
        renderWithRouter(<BottomTabBar />);
        const nav = screen.getByRole('navigation', { name: 'Main navigation' });
        expect(nav).toHaveClass('md:hidden');
    });

    it('applies z-index from Z_INDEX.TAB_BAR (40)', () => {
        renderWithRouter(<BottomTabBar />);
        const nav = screen.getByRole('navigation', { name: 'Main navigation' });
        expect(nav).toHaveStyle({ zIndex: 40 });
    });

    // NOTE: safe area inset (env(safe-area-inset-bottom)) is verified via browser
    // testing rather than jsdom, since jsdom/React strips env() CSS functions.

    it('has fixed positioning at the bottom', () => {
        renderWithRouter(<BottomTabBar />);
        const nav = screen.getByRole('navigation', { name: 'Main navigation' });
        expect(nav).toHaveClass('fixed', 'bottom-0');
    });

    it('tabs have min-w-[60px] for tap target compliance', () => {
        renderWithRouter(<BottomTabBar />);
        const calendarLink = screen.getByText('Calendar').closest('a')!;
        expect(calendarLink.className).toContain('min-w-[60px]');
    });

    it('tabs have active:scale-95 for tap feedback', () => {
        renderWithRouter(<BottomTabBar />);
        const calendarLink = screen.getByText('Calendar').closest('a')!;
        expect(calendarLink.className).toContain('active:scale-95');
    });

    it('matches active tab via pathname prefix (nested routes)', () => {
        renderWithRouter(<BottomTabBar />, { route: '/events/123' });
        const eventsLink = screen.getByText('Events').closest('a')!;
        expect(eventsLink.className).toContain('text-emerald-400');
    });

    it('Games tab links to /games', () => {
        renderWithRouter(<BottomTabBar />);
        const gamesLink = screen.getByText('Games').closest('a')!;
        expect(gamesLink).toHaveAttribute('href', '/games');
    });

    it('has inline transition style for scroll-aware animation', () => {
        renderWithRouter(<BottomTabBar />);
        const nav = screen.getByRole('navigation', { name: 'Main navigation' });
        expect(nav).toHaveStyle({ transition: 'transform 300ms ease-in-out' });
    });
});

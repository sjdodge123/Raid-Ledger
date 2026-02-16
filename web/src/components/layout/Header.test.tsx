import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Header } from './Header';

// Mock heavy child components to avoid pulling in their dependency trees
vi.mock('./UserMenu', () => ({ UserMenu: () => <div data-testid="user-menu" /> }));
vi.mock('./ThemeToggle', () => ({ ThemeToggle: () => <div data-testid="theme-toggle" /> }));
vi.mock('../notifications', () => ({ NotificationBell: () => <div data-testid="notification-bell" /> }));

// Mock hooks
vi.mock('../../hooks/use-auth', () => ({
    useAuth: () => ({ user: null }),
}));

vi.mock('../../hooks/use-system-status', () => ({
    useSystemStatus: () => ({ data: null }),
}));

// Scroll direction mock — default to null, overridden per-test via mockReturnValue
const mockUseScrollDirection = vi.fn().mockReturnValue(null);
vi.mock('../../hooks/use-scroll-direction', () => ({
    useScrollDirection: (...args: unknown[]) => mockUseScrollDirection(...args),
}));

function renderHeader() {
    return render(
        <MemoryRouter>
            <Header onMenuClick={vi.fn()} />
        </MemoryRouter>,
    );
}

describe('Header', () => {
    it('renders the community name', () => {
        renderHeader();
        expect(screen.getByText('Raid Ledger')).toBeInTheDocument();
    });

    it('has sticky positioning at top-0', () => {
        renderHeader();
        const header = document.querySelector('header')!;
        expect(header).toHaveClass('sticky', 'top-0');
    });

    it('applies z-index from Z_INDEX.HEADER (40)', () => {
        renderHeader();
        const header = document.querySelector('header')!;
        expect(header).toHaveStyle({ zIndex: 40 });
    });

    it('has inline transition style for scroll-aware animation', () => {
        renderHeader();
        const header = document.querySelector('header')!;
        expect(header).toHaveStyle({ transition: 'transform 300ms ease-in-out' });
    });

    it('has translate-y-0 when scroll direction is null (initial)', () => {
        mockUseScrollDirection.mockReturnValue(null);
        renderHeader();
        const header = document.querySelector('header')!;
        expect(header).toHaveClass('translate-y-0');
        expect(header).not.toHaveClass('-translate-y-full');
    });

    it('has -translate-y-full when scrolling down', () => {
        mockUseScrollDirection.mockReturnValue('down');
        renderHeader();
        const header = document.querySelector('header')!;
        expect(header).toHaveClass('-translate-y-full');
    });

    it('has translate-y-0 when scrolling up', () => {
        mockUseScrollDirection.mockReturnValue('up');
        renderHeader();
        const header = document.querySelector('header')!;
        expect(header).toHaveClass('translate-y-0');
        expect(header).not.toHaveClass('-translate-y-full');
    });

    it('forces translate-y-0 on desktop via md:translate-y-0', () => {
        mockUseScrollDirection.mockReturnValue('down');
        renderHeader();
        const header = document.querySelector('header')!;
        // Even when hidden on mobile, md:translate-y-0 overrides on desktop
        expect(header).toHaveClass('md:translate-y-0');
    });

    it('has will-change-transform with md:will-change-auto for desktop reset', () => {
        renderHeader();
        const header = document.querySelector('header')!;
        expect(header).toHaveClass('will-change-transform', 'md:will-change-auto');
    });

    it('renders hamburger button for mobile', () => {
        renderHeader();
        expect(screen.getByLabelText('Open menu')).toBeInTheDocument();
    });
});

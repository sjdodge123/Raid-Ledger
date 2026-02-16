import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MoreDrawer } from './more-drawer';

// Mock hooks
const mockUser = {
    id: 1,
    discordId: '123456',
    username: 'TestUser',
    displayName: 'Test User',
    avatar: null,
    customAvatarUrl: null,
    role: 'member' as const,
    onboardingCompletedAt: null,
};

const mockLogout = vi.fn();
const mockNavigate = vi.fn();

vi.mock('../../hooks/use-auth', () => ({
    useAuth: () => ({
        user: mockUser,
        isAuthenticated: true,
        logout: mockLogout,
    }),
    isAdmin: (user: { role?: string } | null) => user?.role === 'admin',
}));

vi.mock('../../stores/theme-store', () => ({
    useThemeStore: (selector: (s: Record<string, unknown>) => unknown) =>
        selector({ themeMode: 'dark', cycleTheme: vi.fn() }),
}));

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    };
});

function renderDrawer(isOpen = true) {
    const onClose = vi.fn();
    render(
        <MemoryRouter>
            <MoreDrawer isOpen={isOpen} onClose={onClose} />
        </MemoryRouter>,
    );
    return { onClose };
}

describe('MoreDrawer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders with md:hidden class for mobile-only visibility', () => {
        renderDrawer();
        const drawer = screen.getByTestId('more-drawer');
        expect(drawer).toHaveClass('md:hidden');
    });

    it('uses Z_INDEX.MODAL (50) for z-index', () => {
        renderDrawer();
        const drawer = screen.getByTestId('more-drawer');
        expect(drawer).toHaveStyle({ zIndex: 50 });
    });

    it('shows user avatar and username when authenticated', () => {
        renderDrawer();
        expect(screen.getByText('TestUser')).toBeInTheDocument();
    });

    it('shows initials fallback when no avatar', () => {
        renderDrawer();
        expect(screen.getByText('T')).toBeInTheDocument();
    });

    it('shows Games and Profile nav links', () => {
        renderDrawer();
        expect(screen.getByText('Games')).toBeInTheDocument();
        expect(screen.getByText('Profile')).toBeInTheDocument();
    });

    it('hides Admin Settings link for non-admin users', () => {
        renderDrawer();
        expect(screen.queryByText('Admin Settings')).not.toBeInTheDocument();
    });

    it('renders logout button with destructive styling', () => {
        renderDrawer();
        const logoutBtn = screen.getByTestId('more-drawer-logout');
        expect(logoutBtn).toBeInTheDocument();
        expect(logoutBtn).toHaveClass('bg-red-500/15', 'text-red-400');
    });

    it('renders close button with aria-label', () => {
        renderDrawer();
        const closeBtn = screen.getByLabelText('Close menu');
        expect(closeBtn).toBeInTheDocument();
    });

    it('renders "More" header text', () => {
        renderDrawer();
        expect(screen.getByText('More')).toBeInTheDocument();
    });

    it('has full-screen panel (inset-0, not w-72)', () => {
        renderDrawer();
        const panel = screen.getByTestId('more-drawer-panel');
        expect(panel).toHaveClass('inset-0');
    });

    it('slides from left (uses -translate-x-full when closed)', () => {
        renderDrawer(false);
        const panel = screen.getByTestId('more-drawer-panel');
        expect(panel).toHaveClass('-translate-x-full');
    });

    it('is visible and translated to 0 when open', () => {
        renderDrawer(true);
        const panel = screen.getByTestId('more-drawer-panel');
        expect(panel).toHaveClass('translate-x-0');
    });

    it('calls onClose when backdrop is clicked', () => {
        const { onClose } = renderDrawer();
        const backdrop = screen.getByTestId('more-drawer-backdrop');
        fireEvent.click(backdrop);
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('calls onClose when close button is clicked', () => {
        const { onClose } = renderDrawer();
        const closeBtn = screen.getByLabelText('Close menu');
        fireEvent.click(closeBtn);
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('has 300ms ease-out transition on panel', () => {
        renderDrawer();
        const panel = screen.getByTestId('more-drawer-panel');
        expect(panel).toHaveClass('duration-300', 'ease-out');
    });

    it('has backdrop blur and dim effect', () => {
        renderDrawer();
        const backdrop = screen.getByTestId('more-drawer-backdrop');
        expect(backdrop).toHaveClass('bg-black/60', 'backdrop-blur-sm');
    });

    it('renders theme toggle button', () => {
        renderDrawer();
        const themeToggle = screen.getByTestId('more-drawer-theme-toggle');
        expect(themeToggle).toBeInTheDocument();
    });
});

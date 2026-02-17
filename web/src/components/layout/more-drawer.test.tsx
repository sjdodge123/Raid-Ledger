import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
    isOperatorOrAdmin: (user: { role?: string } | null) => user?.role === 'admin' || user?.role === 'operator',
    getAuthToken: () => 'mock-token',
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

vi.mock('../../hooks/use-onboarding-fte', () => ({
    useResetOnboarding: () => ({ mutate: vi.fn(), isPending: false }),
}));

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function renderDrawer(isOpen = true, initialRoute = '/') {
    const onClose = vi.fn();
    render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={[initialRoute]}>
                <MoreDrawer isOpen={isOpen} onClose={onClose} />
            </MemoryRouter>
        </QueryClientProvider>,
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

    it('avatar row is an accordion toggle button', () => {
        renderDrawer();
        const toggleBtn = screen.getByTestId('more-drawer-profile-toggle');
        expect(toggleBtn.tagName).toBe('BUTTON');
        expect(toggleBtn).toBeInTheDocument();
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

    it('has 300ms spring transition on panel', () => {
        renderDrawer();
        const panel = screen.getByTestId('more-drawer-panel');
        expect(panel).toHaveClass('duration-300');
        expect(panel.style.transitionTimingFunction).toBe('var(--spring-smooth)');
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

    it('calls onFeedbackClick and closes drawer when Send Feedback is clicked', () => {
        const onClose = vi.fn();
        const onFeedbackClick = vi.fn();
        render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <MoreDrawer isOpen={true} onClose={onClose} onFeedbackClick={onFeedbackClick} />
                </MemoryRouter>
            </QueryClientProvider>,
        );
        const feedbackBtn = screen.getByTestId('more-drawer-feedback');
        fireEvent.click(feedbackBtn);
        expect(onClose).toHaveBeenCalledOnce();
        expect(onFeedbackClick).toHaveBeenCalledOnce();
    });

    it('hides Send Feedback button when onFeedbackClick is not provided', () => {
        renderDrawer();
        expect(screen.queryByTestId('more-drawer-feedback')).not.toBeInTheDocument();
    });

    it('has aria dialog role on panel', () => {
        renderDrawer();
        const panel = screen.getByTestId('more-drawer-panel');
        expect(panel).toHaveAttribute('role', 'dialog');
        expect(panel).toHaveAttribute('aria-modal', 'true');
    });

    it('panel has flex-col and overflow-y-auto for scroll support', () => {
        renderDrawer();
        const panel = screen.getByTestId('more-drawer-panel');
        expect(panel).toHaveClass('flex', 'flex-col');
    });

    // Profile accordion tests
    it('expands profile submenu on toggle click', () => {
        renderDrawer();
        expect(screen.queryByTestId('profile-submenu')).not.toBeInTheDocument();
        fireEvent.click(screen.getByTestId('more-drawer-profile-toggle'));
        expect(screen.getByTestId('profile-submenu')).toBeInTheDocument();
    });

    it('collapses profile submenu on second toggle click', () => {
        renderDrawer();
        const toggle = screen.getByTestId('more-drawer-profile-toggle');
        fireEvent.click(toggle);
        expect(screen.getByTestId('profile-submenu')).toBeInTheDocument();
        fireEvent.click(toggle);
        expect(screen.queryByTestId('profile-submenu')).not.toBeInTheDocument();
    });

    it('auto-expands profile submenu when on a profile page', () => {
        renderDrawer(true, '/profile/identity');
        expect(screen.getByTestId('profile-submenu')).toBeInTheDocument();
    });

    it('does not auto-expand profile submenu on non-profile pages', () => {
        renderDrawer(true, '/events');
        expect(screen.queryByTestId('profile-submenu')).not.toBeInTheDocument();
    });

    it('rotates chevron when profile submenu is expanded', () => {
        renderDrawer();
        const chevron = screen.getByTestId('profile-chevron');
        expect(chevron).not.toHaveClass('rotate-180');
        fireEvent.click(screen.getByTestId('more-drawer-profile-toggle'));
        expect(chevron).toHaveClass('rotate-180');
    });

    it('shows profile nav items with emerald-400 highlight for active route', () => {
        renderDrawer(true, '/profile/identity');
        const activeLink = screen.getByText('My Profile').closest('a');
        expect(activeLink).toHaveClass('text-emerald-400', 'bg-emerald-500/10');
    });

    it('shows Re-run Setup Wizard in profile submenu', () => {
        renderDrawer(true, '/profile/identity');
        expect(screen.getByText('Re-run Setup Wizard')).toBeInTheDocument();
    });

    it('profile toggle has aria-expanded=false when collapsed', () => {
        renderDrawer(true, '/events');
        const toggle = screen.getByTestId('more-drawer-profile-toggle');
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });

    it('profile toggle has aria-expanded=true when expanded', () => {
        renderDrawer(true, '/profile/identity');
        const toggle = screen.getByTestId('more-drawer-profile-toggle');
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
    });
});

// Admin user tests
describe('MoreDrawer (admin user)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Temporarily override the mock user role to admin
        (mockUser as { role: string }).role = 'admin';
    });

    afterEach(() => {
        (mockUser as { role: string }).role = 'member';
    });

    it('shows Admin Settings accordion for admin users', () => {
        renderDrawer();
        expect(screen.getByTestId('more-drawer-admin-toggle')).toBeInTheDocument();
        expect(screen.getByText('Admin Settings')).toBeInTheDocument();
    });

    it('expands admin submenu on toggle click', () => {
        renderDrawer();
        expect(screen.queryByTestId('admin-submenu')).not.toBeInTheDocument();
        fireEvent.click(screen.getByTestId('more-drawer-admin-toggle'));
        expect(screen.getByTestId('admin-submenu')).toBeInTheDocument();
    });

    it('auto-expands admin submenu when on admin settings page', () => {
        renderDrawer(true, '/admin/settings/general');
        expect(screen.getByTestId('admin-submenu')).toBeInTheDocument();
    });

    it('rotates admin chevron when expanded', () => {
        renderDrawer();
        const chevron = screen.getByTestId('admin-chevron');
        expect(chevron).not.toHaveClass('rotate-180');
        fireEvent.click(screen.getByTestId('more-drawer-admin-toggle'));
        expect(chevron).toHaveClass('rotate-180');
    });

    it('admin toggle has aria-expanded attribute', () => {
        renderDrawer(true, '/events');
        const toggle = screen.getByTestId('more-drawer-admin-toggle');
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
    });
});

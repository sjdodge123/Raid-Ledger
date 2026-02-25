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

    it('renders logout button', () => {
        renderDrawer();
        const logoutBtn = screen.getByTestId('more-drawer-logout');
        expect(logoutBtn).toBeInTheDocument();
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

    it('admin toggle has aria-expanded attribute', () => {
        renderDrawer(true, '/events');
        const toggle = screen.getByTestId('more-drawer-admin-toggle');
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
    });
});

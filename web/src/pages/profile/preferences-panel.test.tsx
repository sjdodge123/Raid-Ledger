/**
 * Unit tests for the PreferencesPanel (ROK-548).
 * Verifies it renders Appearance, Timezone, and AutoHeartToggle.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PreferencesPanel } from './preferences-panel';

vi.mock('./appearance-panel', () => ({
    AppearancePanel: () => <div data-testid="appearance-panel">Appearance Content</div>,
}));

vi.mock('../../components/profile/TimezoneSection', () => ({
    TimezoneSection: () => <div data-testid="timezone-section">Timezone Content</div>,
}));

vi.mock('../../hooks/use-auth', () => ({
    useAuth: () => ({
        user: { id: 1, discordId: '123' },
        isAuthenticated: true,
    }),
}));

vi.mock('../../lib/avatar', () => ({
    isDiscordLinked: () => true,
}));

vi.mock('../../lib/api-client', () => ({
    getMyPreferences: vi.fn().mockResolvedValue({ autoHeartGames: true }),
    updatePreference: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/toast', () => ({
    toast: { success: vi.fn(), error: vi.fn() },
}));

function renderWithQueryClient(ui: React.ReactElement) {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    return render(
        <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
    );
}

describe('PreferencesPanel (ROK-548)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders the AppearancePanel sub-component', () => {
        renderWithQueryClient(<PreferencesPanel />);
        expect(screen.getByTestId('appearance-panel')).toBeInTheDocument();
    });

    it('renders the TimezoneSection sub-component', () => {
        renderWithQueryClient(<PreferencesPanel />);
        expect(screen.getByTestId('timezone-section')).toBeInTheDocument();
    });

    it('renders Appearance section before Timezone section in the DOM', () => {
        const { container } = renderWithQueryClient(<PreferencesPanel />);
        const appearance = container.querySelector('[data-testid="appearance-panel"]');
        const timezone = container.querySelector('[data-testid="timezone-section"]');
        expect(appearance).not.toBeNull();
        expect(timezone).not.toBeNull();
        expect(
            appearance!.compareDocumentPosition(timezone!) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });

    it('renders AutoHeartToggle with auto-heart label', () => {
        renderWithQueryClient(<PreferencesPanel />);
        expect(screen.getByText(/auto-heart games/i)).toBeInTheDocument();
    });

    it('renders auto-heart toggle switch', () => {
        renderWithQueryClient(<PreferencesPanel />);
        expect(screen.getByRole('switch')).toBeInTheDocument();
    });
});


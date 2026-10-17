/**
 * Tests for auto-heart toggle visibility when Discord is NOT linked (ROK-548).
 * Uses a separate file so we can mock isDiscordLinked to return false,
 * which can't be changed per-test in the main panel test files.
 *
 * AC: Auto-heart toggle should only appear when the user has Discord linked.
 * Both PreferencesPanel and WatchedGamesPanel share this behavior via useAutoHeart.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/avatar', () => ({
    isDiscordLinked: vi.fn(() => false),
}));

vi.mock('../../hooks/use-auth', () => ({
    useAuth: vi.fn(() => ({
        user: { id: 1, discordId: null },
        isAuthenticated: true,
    })),
}));

vi.mock('../../lib/api-client', () => ({
    getMyPreferences: vi.fn().mockResolvedValue({}),
    updatePreference: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/toast', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('./appearance-panel', () => ({
    AppearancePanel: () => <div data-testid="appearance-panel">Appearance</div>,
}));

vi.mock('../../components/profile/TimezoneSection', () => ({
    TimezoneSection: () => <div data-testid="timezone-section">Timezone</div>,
}));

vi.mock('../../components/profile/my-watched-games-section', () => ({
    MyWatchedGamesSection: () => <div data-testid="watched-games">Watched Games</div>,
}));

import { PreferencesPanel } from './preferences-panel';
import { WatchedGamesPanel } from './watched-games-panel';

function makeWrapper() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return function Wrapper({ children }: { children: React.ReactNode }) {
        return (
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>{children}</MemoryRouter>
            </QueryClientProvider>
        );
    };
}

describe('PreferencesPanel — no Discord linked', () => {
    it('does not render AutoHeartToggle when Discord is not linked', () => {
        const { wrapper: Wrapper } = { wrapper: makeWrapper() };
        render(<Wrapper><PreferencesPanel /></Wrapper>);
        expect(screen.queryByText(/auto-heart games/i)).not.toBeInTheDocument();
        expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    });

    it('still renders AppearancePanel and TimezoneSection without Discord', () => {
        const { wrapper: Wrapper } = { wrapper: makeWrapper() };
        render(<Wrapper><PreferencesPanel /></Wrapper>);
        expect(screen.getByTestId('appearance-panel')).toBeInTheDocument();
        expect(screen.getByTestId('timezone-section')).toBeInTheDocument();
    });
});

describe('WatchedGamesPanel — no Discord linked', () => {
    it('does not render AutoHeartToggle when Discord is not linked', () => {
        const { wrapper: Wrapper } = { wrapper: makeWrapper() };
        render(<Wrapper><WatchedGamesPanel /></Wrapper>);
        expect(screen.queryByText(/auto-heart games/i)).not.toBeInTheDocument();
        expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    });

    it('still renders MyWatchedGamesSection without Discord', () => {
        const { wrapper: Wrapper } = { wrapper: makeWrapper() };
        render(<Wrapper><WatchedGamesPanel /></Wrapper>);
        expect(screen.getByTestId('watched-games')).toBeInTheDocument();
    });
});

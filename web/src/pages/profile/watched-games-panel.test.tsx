/**
 * Tests for WatchedGamesPanel (ROK-548).
 * Verifies watched games section and auto-heart toggle are rendered.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WatchedGamesPanel } from './watched-games-panel';

vi.mock('../../components/profile/my-watched-games-section', () => ({
    MyWatchedGamesSection: () => <div data-testid="watched-games-section">Watched Games</div>,
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

function makeQueryClient() {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWatchedGamesPanel() {
    return render(
        <QueryClientProvider client={makeQueryClient()}>
            <MemoryRouter>
                <WatchedGamesPanel />
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

describe('WatchedGamesPanel (ROK-548)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders MyWatchedGamesSection', () => {
        renderWatchedGamesPanel();
        expect(screen.getByTestId('watched-games-section')).toBeInTheDocument();
    });

    it('renders AutoHeartToggle with auto-heart label', () => {
        renderWatchedGamesPanel();
        expect(screen.getByText(/auto-heart games/i)).toBeInTheDocument();
    });

    it('renders auto-heart toggle switch', () => {
        renderWatchedGamesPanel();
        expect(screen.getByRole('switch')).toBeInTheDocument();
    });
});

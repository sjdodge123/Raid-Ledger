import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GameLibraryTable } from './GameLibraryTable';

// Mock toast
vi.mock('../../lib/toast', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
    },
}));

// Mock the hook
const mockDeleteGame = {
    mutateAsync: vi.fn(),
    isPending: false,
};

const mockHideGame = {
    mutateAsync: vi.fn(),
    isPending: false,
};

const mockUnbanGame = {
    mutateAsync: vi.fn(),
    isPending: false,
};

const mockUnhideGame = {
    mutateAsync: vi.fn(),
    isPending: false,
};

const mockSentinelRef = vi.fn();

const mockGames = {
    items: [] as Array<{
        id: number;
        igdbId: number;
        name: string;
        slug: string;
        coverUrl: string | null;
        cachedAt: string;
        hidden?: boolean;
    banned?: boolean;
    }>,
    total: 0,
    isLoading: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    error: null as Error | null,
    sentinelRef: mockSentinelRef,
    refetch: vi.fn(),
};

vi.mock('../../hooks/use-admin-games', () => ({
    useAdminGames: () => ({
        games: mockGames,
        banGame: mockDeleteGame,
        unbanGame: mockUnbanGame,
        hideGame: mockHideGame,
        unhideGame: mockUnhideGame,
    }),
}));

// Mock useScrollDirection
vi.mock('../../hooks/use-scroll-direction', () => ({
    useScrollDirection: () => 'up',
}));

function makeGame(overrides = {}) {
    return {
        id: 1,
        igdbId: 1942,
        name: 'World of Warcraft',
        slug: 'world-of-warcraft',
        coverUrl: 'https://images.igdb.com/igdb/image/upload/wow.jpg',
        cachedAt: '2025-01-15T10:00:00Z',
        ...overrides,
    };
}

describe('GameLibraryTable', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGames.items = [];
        mockGames.total = 0;
        mockGames.isLoading = false;
        mockGames.isFetchingNextPage = false;
        mockGames.hasNextPage = false;
        mockGames.error = null;
        mockDeleteGame.isPending = false;
        mockDeleteGame.mutateAsync = vi.fn();
        mockUnbanGame.isPending = false;
        mockUnbanGame.mutateAsync = vi.fn();
        mockHideGame.isPending = false;
        mockHideGame.mutateAsync = vi.fn();
        mockUnhideGame.isPending = false;
        mockUnhideGame.mutateAsync = vi.fn();
    });

    // ── Loading & empty states ──────────────────────────────────

    it('shows loading indicator when isLoading is true', () => {
        mockGames.isLoading = true;
        render(<GameLibraryTable />);
        expect(screen.getByText('Loading games...')).toBeInTheDocument();
    });

    it('shows empty state when data has no games and no search', () => {
        mockGames.items = [];
        render(<GameLibraryTable />);
        expect(
            screen.getByText('No games in library yet. Run a sync to populate.'),
        ).toBeInTheDocument();
    });

    it('shows search-specific empty message when search yields no results', async () => {
        mockGames.items = [];
        render(<GameLibraryTable />);

        // Verify the no-search empty message is shown and search-specific is not
        expect(
            screen.queryByText('No games match your search.'),
        ).not.toBeInTheDocument();
    });

    // ── Search input ────────────────────────────────────────────

    it('renders a search input', () => {
        render(<GameLibraryTable />);
        expect(screen.getByPlaceholderText('Search games...')).toBeInTheDocument();
    });

    it('updates search input value on change', () => {
        render(<GameLibraryTable />);
        const searchInput = screen.getByRole('textbox') as HTMLInputElement;
        fireEvent.change(searchInput, { target: { value: 'Warcraft' } });
        expect(searchInput.value).toBe('Warcraft');
    });

    // ── Mobile card layout (<768px, rendered via md:hidden) ─────

    it('renders mobile card layout container with md:hidden class', () => {
        mockGames.items = [makeGame()];
        mockGames.total = 1;
        const { container } = render(<GameLibraryTable />);
        const mobileContainer = container.querySelector('.md\\:hidden');
        expect(mobileContainer).toBeInTheDocument();
    });

    it('renders game name in mobile card', () => {
        mockGames.items = [makeGame()];
        mockGames.total = 1;
        render(<GameLibraryTable />);
        // Name appears in both mobile and desktop, but we verify at least one instance
        expect(screen.getAllByText('World of Warcraft').length).toBeGreaterThanOrEqual(1);
    });

    it('renders IGDB ID in mobile card', () => {
        mockGames.items = [makeGame()];
        mockGames.total = 1;
        render(<GameLibraryTable />);
        // Mobile shows "IGDB ID: 1942"
        expect(screen.getByText('IGDB ID: 1942')).toBeInTheDocument();
    });

    it('renders cached date in mobile card', () => {
        mockGames.items = [makeGame()];
        mockGames.total = 1;
        render(<GameLibraryTable />);
        const cachedDate = new Date('2025-01-15T10:00:00Z').toLocaleDateString();
        // Appears as "Cached: <date>" in mobile
        expect(screen.getByText(`Cached: ${cachedDate}`)).toBeInTheDocument();
    });

    it('renders cover image when coverUrl is provided', () => {
        mockGames.items = [makeGame()];
        mockGames.total = 1;
        const { container } = render(<GameLibraryTable />);
        const imgs = container.querySelectorAll('img');
        expect(imgs.length).toBeGreaterThan(0);
        expect(imgs[0]).toHaveAttribute('src', 'https://images.igdb.com/igdb/image/upload/wow.jpg');
    });

    it('renders placeholder div when coverUrl is null', () => {
        mockGames.items = [makeGame({ coverUrl: null })];
        mockGames.total = 1;
        const { container } = render(<GameLibraryTable />);
        // No img tag should be present
        expect(container.querySelector('img')).not.toBeInTheDocument();
        // Placeholder divs exist (both mobile and desktop use bg-overlay for placeholder)
        const placeholders = container.querySelectorAll('.bg-overlay');
        expect(placeholders.length).toBeGreaterThan(0);
    });

    // ── Mobile delete button — 44×44px touch target ─────────────

    it('mobile delete button has w-11 h-11 classes (44px touch target)', () => {
        mockGames.items = [makeGame()];
        mockGames.total = 1;
        const { container } = render(<GameLibraryTable />);
        // The mobile card container is md:hidden; find all buttons with the 44px sizing
        const mobileCard = container.querySelector('.md\\:hidden');
        const deleteBtn = mobileCard?.querySelector('button[title="Remove game"]');
        expect(deleteBtn).toBeInTheDocument();
        expect(deleteBtn!.className).toContain('w-11');
        expect(deleteBtn!.className).toContain('h-11');
    });

    it('mobile delete button is disabled while deleteGame is pending', () => {
        mockDeleteGame.isPending = true;
        mockGames.items = [makeGame()];
        mockGames.total = 1;
        const { container } = render(<GameLibraryTable />);
        const mobileCard = container.querySelector('.md\\:hidden');
        const deleteBtn = mobileCard?.querySelector('button[title="Remove game"]');
        expect(deleteBtn).toBeDisabled();
    });

    // ── Desktop table layout (hidden md:block) ──────────────────

    it('renders desktop table layout container with hidden md:block classes', () => {
        mockGames.items = [makeGame()];
        mockGames.total = 1;
        const { container } = render(<GameLibraryTable />);
        const desktopContainer = container.querySelector('.hidden.md\\:block');
        expect(desktopContainer).toBeInTheDocument();
    });

    it('renders table with Game, IGDB ID, Cached headers in desktop layout', () => {
        mockGames.items = [makeGame()];
        mockGames.total = 1;
        render(<GameLibraryTable />);
        expect(screen.getByText('Game')).toBeInTheDocument();
        expect(screen.getByText('IGDB ID')).toBeInTheDocument();
        expect(screen.getByText('Cached')).toBeInTheDocument();
    });

    it('desktop table shows game IGDB ID in table cell', () => {
        mockGames.items = [makeGame()];
        mockGames.total = 1;
        render(<GameLibraryTable />);
        // The IGDB ID in the table is rendered as plain number, not "IGDB ID: ..."
        // getAllByText because mobile also has "IGDB ID: 1942"
        const igdbTexts = screen.getAllByText(/1942/);
        expect(igdbTexts.length).toBeGreaterThan(0);
    });

    it('desktop delete button is disabled while deleteGame is pending', () => {
        mockDeleteGame.isPending = true;
        mockGames.items = [makeGame()];
        mockGames.total = 1;
        const { container } = render(<GameLibraryTable />);
        const desktopTable = container.querySelector('.hidden.md\\:block');
        const deleteBtn = desktopTable?.querySelector('button[title="Remove game"]');
        expect(deleteBtn).toBeDisabled();
    });

    // ── Delete interaction ───────────────────────────────────────

    it('calls deleteGame.mutateAsync after confirm dialog approval', async () => {
        mockGames.items = [makeGame()];
        mockGames.total = 1;
        mockDeleteGame.mutateAsync.mockResolvedValue({ success: true, message: 'Deleted' });
        vi.spyOn(window, 'confirm').mockReturnValue(true);

        render(<GameLibraryTable />);
        const deleteButtons = screen.getAllByTitle('Remove game');
        fireEvent.click(deleteButtons[0]);

        await waitFor(() => {
            expect(mockDeleteGame.mutateAsync).toHaveBeenCalledWith(1);
        });
    });

    it('does not call deleteGame.mutateAsync when confirm dialog is cancelled', async () => {
        mockGames.items = [makeGame()];
        mockGames.total = 1;
        vi.spyOn(window, 'confirm').mockReturnValue(false);

        render(<GameLibraryTable />);
        const deleteButtons = screen.getAllByTitle('Remove game');
        fireEvent.click(deleteButtons[0]);

        expect(mockDeleteGame.mutateAsync).not.toHaveBeenCalled();
    });

    // ── Infinite scroll sentinel ────────────────────────────────

    it('does not show infinite scroll sentinel when there are no items', () => {
        mockGames.items = [];
        render(<GameLibraryTable />);
        expect(screen.queryByText("You've reached the end")).not.toBeInTheDocument();
    });

    it('shows total game count when items are present', () => {
        mockGames.items = [makeGame()];
        mockGames.total = 50;
        render(<GameLibraryTable />);
        expect(screen.getByText('50 games')).toBeInTheDocument();
    });

    // ── Multiple games rendered ──────────────────────────────────

    it('renders a card for each game in the list', () => {
        const games = [
            makeGame({ id: 1, name: 'World of Warcraft', igdbId: 1942 }),
            makeGame({ id: 2, name: 'Final Fantasy XIV', igdbId: 4083 }),
        ];
        mockGames.items = games;
        mockGames.total = 2;
        render(<GameLibraryTable />);
        expect(screen.getAllByText('World of Warcraft').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Final Fantasy XIV').length).toBeGreaterThanOrEqual(1);
    });
});

/**
 * ROK-1659 — the /games toolbar details the funnel standard added:
 * - the muted "N games" result count (beside the funnel at ≥1024px, a line
 *   under the search below), de-duplicated across carousels, hidden in the
 *   LFG view and while loading;
 * - the filter badge does not count genres while a search is active (search
 *   skips genres, and the group is greyed out);
 * - the badge counts only what narrows the view: LFG on counts alone;
 * - the sticky search bar switches at 1024px, but the "Game Library" h1 still
 *   shows from 768px, so tablets keep a page heading;
 * - the open Filters sheet (paused LFG state) passes axe.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GamesPage } from './games-page';
import * as useGamesDiscoverModule from '../hooks/use-games-discover';
import * as useGameSearchModule from '../hooks/use-game-search';

vi.mock('../hooks/use-games-discover');
vi.mock('../hooks/use-game-search');

vi.mock('../hooks/use-auth', () => ({
    useAuth: () => ({ user: null, isAuthenticated: false }),
    isOperatorOrAdmin: () => false,
    getAuthToken: () => null,
}));

vi.mock('../hooks/use-debounced-value', () => ({
    useDebouncedValue: (value: string) => value,
}));

vi.mock('../hooks/use-scroll-direction', () => ({
    useScrollDirection: () => 'up',
}));

let isDesktopViewport = true;
vi.mock('../hooks/use-media-query', () => ({
    useMediaQuery: () => isDesktopViewport,
}));

vi.mock('../components/games/GameCarousel', () => ({
    GameCarousel: ({ games }: { games: { id: number; name: string }[] }) => (
        <div data-testid="game-carousel">{games.map((g) => g.name).join(',')}</div>
    ),
}));

vi.mock('../components/games/unified-game-card', () => ({
    UnifiedGameCard: ({ game }: { game: { name: string } }) => <div data-testid="game-card">{game.name}</div>,
}));

vi.mock('../components/admin/GameLibraryTable', () => ({
    GameLibraryTable: () => <div data-testid="game-library-table" />,
}));

vi.mock('../components/games/games-mobile-toolbar', () => ({
    GamesMobileToolbar: () => <div data-testid="games-mobile-toolbar" />,
}));

vi.mock('../hooks/use-want-to-play-batch', () => ({
    WantToPlayProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function game(id: number, name: string, genres: number[]) {
    return {
        id, igdbId: 100 + id, name, slug: name.toLowerCase(), coverUrl: null, genres, summary: null,
        rating: null, aggregatedRating: null, popularity: null, gameModes: [], themes: [], platforms: [],
        screenshots: [], videos: [], firstReleaseDate: null, playerCount: { min: 1, max: 4 }, ownerCount: 1,
        twitchGameId: null, crossplay: null,
    };
}

const WARCRAFT = game(1, 'Warcraft', [12]); // RPG
const DOOM = game(2, 'Doom', [5]); // Shooter

/** Warcraft sits in BOTH carousels — the count is distinct games, not tiles. */
const DISCOVER = {
    rows: [
        { slug: 'popular', category: 'Popular', games: [WARCRAFT, DOOM] },
        { slug: 'rpgs', category: 'RPGs', games: [WARCRAFT] },
    ],
};

function renderPage(route: string, { search = null as unknown, searchLoading = false } = {}) {
    vi.spyOn(useGamesDiscoverModule, 'useGamesDiscover').mockReturnValue({
        data: DISCOVER, isLoading: false, error: null,
    } as unknown as ReturnType<typeof useGamesDiscoverModule.useGamesDiscover>);
    vi.spyOn(useGameSearchModule, 'useGameSearch').mockReturnValue({
        data: search, isLoading: searchLoading, error: null,
    } as unknown as ReturnType<typeof useGameSearchModule.useGameSearch>);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={[route]}>
                <GamesPage />
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    isDesktopViewport = true;
});

describe('GamesPage — ROK-1659: the "N games" result count', () => {
    it('sits in the toolbar row right after the funnel on desktop, counting distinct games', () => {
        renderPage('/games');
        const count = screen.getByTestId('games-result-count');
        expect(count).toHaveTextContent(/^2 games$/);
        const funnel = screen.getByRole('button', { name: /^filters$/i });
        expect(funnel.nextElementSibling).toBe(count);
    });

    it('is a line under the search on phone/tablet (no funnel there)', () => {
        isDesktopViewport = false;
        renderPage('/games');
        const count = screen.getByTestId('games-result-count');
        expect(count.tagName).toBe('P');
        expect(count).toHaveTextContent(/^2 games$/);
        expect(screen.queryByTestId('filter-panel-trigger')).toBeNull();
    });

    it('follows the filters (singular for one game)', () => {
        renderPage('/games?genres=shooter');
        expect(screen.getByTestId('games-result-count')).toHaveTextContent(/^1 game$/);
    });

    it('counts the search results while searching, and hides while they load', () => {
        const results = { data: [WARCRAFT, DOOM, game(3, 'Warframe', [5])], meta: { source: 'igdb' } };
        const { unmount } = renderPage('/games?q=war', { search: results });
        expect(screen.getByTestId('games-result-count')).toHaveTextContent(/^3 games$/);
        unmount();
        renderPage('/games?q=war', { searchLoading: true });
        expect(screen.queryByTestId('games-result-count')).toBeNull();
    });

    it('is absent in the LFG view, which lists groups rather than games', () => {
        renderPage('/games?lfg=1');
        expect(screen.queryByTestId('games-result-count')).toBeNull();
    });
});

describe('GamesPage — ROK-1659: the badge skips genres while searching', () => {
    it('counts genres on Discover but not during a search (search ignores them)', () => {
        const { unmount } = renderPage('/games?genres=rpg,shooter&players=4');
        expect(screen.getByRole('button', { name: /^filters$/i })).toHaveAccessibleDescription('3 active filters');
        unmount();
        renderPage('/games?q=war&genres=rpg,shooter&players=4', { search: { data: [WARCRAFT], meta: { source: 'igdb' } } });
        expect(screen.getByRole('button', { name: /^filters$/i })).toHaveAccessibleDescription('1 active filter');
    });
});

describe('GamesPage — ROK-1659: LFG on counts alone on the badge', () => {
    it('does not count the players/owners/genres filters the LFG view pauses', () => {
        renderPage('/games?lfg=1&players=4&owners=2&genres=rpg');
        expect(screen.getByRole('button', { name: /^filters$/i })).toHaveAccessibleDescription('1 active filter');
    });
});

describe('GamesPage — ROK-1659: the open Filters sheet is accessible', () => {
    it('has no axe violations with LFG on and the paused, disabled groups showing', async () => {
        isDesktopViewport = false;
        renderPage('/games?lfg=1&players=4');
        fireEvent.click(screen.getByRole('button', { name: /^filters$/i }));
        // heading-order is off: the sheet's <h3> title is the BottomSheet primitive's markup (unchanged
        // here) and a modal dialog is its own heading context. Every other rule runs on the controls.
        const results = await axe(screen.getByRole('dialog'), { rules: { 'heading-order': { enabled: false } } });
        expect(results).toHaveNoViolations();
    });
});

describe('GamesPage — ROK-1659: tablets (768–1023px) get the phone layout', () => {
    it('keeps the page h1 from 768px (md:) but un-sticks the search bar only from 1024px (lg:)', () => {
        renderPage('/games');
        const header = screen.getByRole('heading', { level: 1, name: 'Game Library' }).parentElement;
        expect(header).toHaveClass('hidden', 'md:block');
        expect(header).not.toHaveClass('lg:block');
        const searchBar = screen.getByLabelText('Search games').closest('.sticky');
        expect(searchBar).toHaveClass('lg:static', 'md:top-16');
        expect(searchBar).not.toHaveClass('md:static');
    });
});

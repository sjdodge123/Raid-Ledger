/**
 * ROK-1525 slice 3 — the player-count / ownership chip row, and its wiring into
 * the Discover tab.
 *
 * What is pinned here:
 *   • the row speaks the SAME visual language as `LfgFilterChip` (ROK-1478) —
 *     one `<button type="button">` per preset, `aria-pressed` reflecting the
 *     URL, the shared pill geometry and a 44px minimum target. A chip row that
 *     drifts from the chip beside it is the failure mode this story is most
 *     likely to produce, so the class string is asserted, not eyeballed;
 *   • every write COMPOSES: `lfg`, `players`, `owners` and the genre state all
 *     survive each other (operator ruling — the filters AND together and the
 *     combined state is URL-persisted);
 *   • pressing the ACTIVE preset clears it, exactly as the `lfg` toggle does;
 *   • the NULL-semantics hint appears only while a predicate is active
 *     (`coop-filter-section.tsx:90-99` is the precedent — a filter that drops
 *     rows with no data says so instead of silently emptying the grid);
 *   • and the end-to-end case: with `?players=4` a 1-2 player game is GONE from
 *     the rendered discover rows while a 1-8 player game stays. That one covers
 *     the `games-page.tsx` wiring, which no unit test of the predicates reaches.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSearchParams } from 'react-router-dom';
import { renderWithProviders } from '../../test/render-helpers';
import { LibraryFilterChips } from './library-filter-chips';
import { GamesPage } from '../games-page';
import * as useGamesDiscoverModule from '../../hooks/use-games-discover';
import * as useGameSearchModule from '../../hooks/use-game-search';

vi.mock('../../hooks/use-games-discover');
vi.mock('../../hooks/use-game-search');

vi.mock('../../hooks/use-auth', () => ({
    useAuth: () => ({ user: null, isAuthenticated: false }),
    isOperatorOrAdmin: () => false,
    getAuthToken: () => null,
}));

vi.mock('../../hooks/use-scroll-direction', () => ({
    useScrollDirection: () => 'up',
}));

vi.mock('../../hooks/use-media-query', () => ({
    useMediaQuery: () => true,
}));

vi.mock('../../hooks/use-want-to-play-batch', () => ({
    WantToPlayProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../components/admin/GameLibraryTable', () => ({
    GameLibraryTable: () => <div data-testid="game-library-table" />,
}));

vi.mock('../../components/games/games-mobile-toolbar', () => ({
    GamesMobileToolbar: () => <div data-testid="games-mobile-toolbar" />,
}));

/** Both discover surfaces render; reduce each to the game's name. */
vi.mock('../../components/games/GameCarousel', () => ({
    GameCarousel: ({ games }: { games: { id: number; name: string }[] }) => (
        <div>
            {games.map((g) => (
                <span key={g.id} data-testid="grid-game">
                    {g.name}
                </span>
            ))}
        </div>
    ),
}));

vi.mock('../../components/games/DrawerCard', () => ({
    DrawerCard: ({ game }: { game: { name: string } }) => (
        <span data-testid="grid-game">{game.name}</span>
    ),
}));

/** Exposes the live query string so a click's effect is observable. */
function SearchProbe() {
    const [params] = useSearchParams();
    return <span data-testid="search-probe">{params.toString()}</span>;
}

function renderChips(url: string) {
    return renderWithProviders(
        <>
            <LibraryFilterChips />
            <SearchProbe />
        </>,
        { initialEntries: [url] },
    );
}

function search(): URLSearchParams {
    return new URLSearchParams(screen.getByTestId('search-probe').textContent ?? '');
}

function chip(key: string): HTMLElement {
    return screen.getByTestId(`player-count-chip-${key}`);
}

const PRESET_KEYS = ['2', '3', '4', '5plus'] as const;

describe('LibraryFilterChips — the preset row matches the LfgFilterChip pattern', () => {
    it('renders all four presets as unpressed toggles with the shared pill geometry', () => {
        renderChips('/games');

        for (const key of PRESET_KEYS) {
            const button = chip(key);
            expect(button).toHaveAttribute('type', 'button');
            expect(button).toHaveAttribute('aria-pressed', 'false');
            // Same pill geometry + 44px target as `lfg-filter-chip.tsx:24-31`.
            expect(button.className).toContain('rounded-full');
            expect(button.className).toContain('min-h-[44px]');
            expect(button.className).toContain('px-3');
        }
        expect(screen.getByText('5+')).toBeInTheDocument();
    });

    it('writes players=4 and flips aria-pressed when a preset is clicked', async () => {
        const user = userEvent.setup();
        renderChips('/games');

        await user.click(chip('4'));

        expect(search().get('players')).toBe('4');
        expect(chip('4')).toHaveAttribute('aria-pressed', 'true');
        expect(chip('2')).toHaveAttribute('aria-pressed', 'false');
    });

    it('clears the param when the ACTIVE preset is pressed again', async () => {
        const user = userEvent.setup();
        renderChips('/games?players=4');

        expect(chip('4')).toHaveAttribute('aria-pressed', 'true');
        await user.click(chip('4'));

        expect(search().has('players')).toBe(false);
        expect(chip('4')).toHaveAttribute('aria-pressed', 'false');
    });
});

describe('LibraryFilterChips — NULL-semantics disclosure', () => {
    it('shows the hint only while a filter is active', async () => {
        const user = userEvent.setup();
        renderChips('/games');

        expect(screen.queryByTestId('library-filter-hint')).not.toBeInTheDocument();

        await user.click(chip('3'));

        expect(screen.getByTestId('library-filter-hint')).toBeInTheDocument();
    });
});

describe('LibraryFilterChips — the filters compose', () => {
    it('writes owners alongside lfg, players and genre without dropping any', async () => {
        const user = userEvent.setup();
        renderChips('/games?lfg=1&genre=rpg&players=4');

        await user.click(screen.getByTestId('owners-filter-chip'));

        const params = search();
        expect(params.get('owners')).toBe('2');
        expect(params.get('players')).toBe('4');
        expect(params.get('lfg')).toBe('1');
        expect(params.get('genre')).toBe('rpg');
        expect(screen.getByTestId('owners-filter-chip')).toHaveAttribute('aria-pressed', 'true');
    });
});

const duoGame = {
    id: 1,
    name: 'Duo Game',
    genres: [],
    playerCount: { min: 1, max: 2 },
    ownerCount: 3,
};
const partyGame = {
    id: 2,
    name: 'Party Game',
    genres: [],
    playerCount: { min: 1, max: 8 },
    ownerCount: 3,
};

function mockDiscoverRows() {
    vi.spyOn(useGamesDiscoverModule, 'useGamesDiscover').mockReturnValue({
        data: { rows: [{ slug: 'row-1', category: 'Popular', games: [duoGame, partyGame] }] },
        isLoading: false,
        error: null,
    } as unknown as ReturnType<typeof useGamesDiscoverModule.useGamesDiscover>);
    vi.spyOn(useGameSearchModule, 'useGameSearch').mockReturnValue({
        data: null,
        isLoading: false,
        error: null,
    } as unknown as ReturnType<typeof useGameSearchModule.useGameSearch>);
}

function renderGamesPage(url: string) {
    return renderWithProviders(<GamesPage />, { initialEntries: [url] });
}

function renderedGameNames(): string[] {
    return screen.queryAllByTestId('grid-game').map((el) => el.textContent ?? '');
}

describe('GamesPage — the chip row narrows the discover rows (end-to-end)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        sessionStorage.clear();
        mockDiscoverRows();
    });

    it('renders both games while no player filter is active', () => {
        renderGamesPage('/games');

        expect(renderedGameNames()).toContain('Duo Game');
        expect(renderedGameNames()).toContain('Party Game');
    });

    it('drops a 1-2 player game while players=4 is active and keeps a 1-8 game', () => {
        renderGamesPage('/games?players=4');

        expect(renderedGameNames()).not.toContain('Duo Game');
        expect(renderedGameNames()).toContain('Party Game');
    });
});

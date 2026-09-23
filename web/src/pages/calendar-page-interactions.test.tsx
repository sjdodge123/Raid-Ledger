import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeGame, makeRegistryGame, renderPage, deliverGames } from './calendar-page.test-helpers';

// ---------------------------------------------------------------------------
// Module mocks — must be declared before the component import
// ---------------------------------------------------------------------------

vi.mock('../hooks/use-auth', () => ({
    useAuth: () => ({ isAuthenticated: false, user: null }),
    getAuthToken: () => null,
}));

vi.mock('../hooks/use-game-time', () => ({
    useGameTime: () => ({ data: null }),
}));

let mockRegistryGames: ReturnType<typeof makeRegistryGame>[] = [];
vi.mock('../hooks/use-game-registry', () => ({
    useGameRegistry: () => ({ games: mockRegistryGames, isLoading: false, error: null }),
}));

let mockIsDesktop = true;
vi.mock('../hooks/use-media-query', () => ({ useMediaQuery: () => mockIsDesktop }));

vi.mock('../components/calendar', () => ({
    // ROK-1662: the page hands the Filters funnel + inline panel to CalendarView's toolbar slots.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    CalendarView: (props: any) => <div data-testid="calendar-view">{props.toolbarAction}{props.belowToolbar}</div>,
    MiniCalendar: () => <div data-testid="mini-calendar" />,
}));

vi.mock('../components/calendar/calendar-mobile-toolbar', () => ({
    CalendarMobileToolbar: () => <div data-testid="mobile-toolbar" />,
}));

vi.mock('../components/calendar/calendar-mobile-nav', () => ({
    CalendarMobileNav: () => <div data-testid="mobile-nav" />,
}));

vi.mock('../components/ui/bottom-sheet', () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    BottomSheet: (props: any) => (
        <div data-testid="bottom-sheet" data-open={props.isOpen ? 'true' : 'false'}>
            <button data-testid="bottom-sheet-close" onClick={props.onClose}>Close Sheet</button>
            {props.children}
        </div>
    ),
}));

vi.mock('../constants/game-colors', () => ({
    getGameColors: () => ({ bg: '#fff', border: '#ccc', icon: '🎮' }),
}));

vi.mock('../components/calendar/calendar-styles.css', () => ({}));

vi.mock('../hooks/use-focus-trap', () => ({
    useFocusTrap: () => ({ current: null }),
}));

// ---------------------------------------------------------------------------
// Component under test (imported after mocks are in place)
// ---------------------------------------------------------------------------
import { CalendarPage } from './calendar-page';
import { useGameFilterStore } from '../stores/game-filter-store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let activeQueryClient: QueryClient;

function render_page() {
    const result = renderPage(CalendarPage);
    activeQueryClient = result.queryClient;
    return result;
}

function deliver(games: ReturnType<typeof makeGame>[]) {
    deliverGames(games, useGameFilterStore.getState().reportGames);
}

/** The desktop toolbar funnel (1024px and up). */
function getFunnel(): HTMLElement {
    return screen.getByTestId('filter-panel-trigger');
}

function openFilters() {
    fireEvent.click(getFunnel());
}

/** The desktop inline filter panel. */
function getDialog() {
    return screen.getByTestId('filter-panel');
}

/** A checkbox row's accessible name: its aria-labelledby text minus aria-hidden decoration (the emoji). */
function nameOf(cb: HTMLElement): string {
    const label = document.getElementById(cb.getAttribute('aria-labelledby') ?? '')?.cloneNode(true) as HTMLElement | undefined;
    label?.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
    return label?.textContent ?? '';
}

/** A game's row checkbox in the open panel, by the game's accessible name. */
function gameCheckbox(name: string | RegExp): HTMLInputElement {
    return within(getDialog()).getByRole('checkbox', { name }) as HTMLInputElement;
}

const SIX_GAMES = () => [
    makeGame('a', 'Alpha'), makeGame('b', 'Beta'), makeGame('c', 'Gamma'),
    makeGame('d', 'Delta'), makeGame('e', 'Epsilon'), makeGame('f', 'Foxtrot'),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function resetStore() {
    vi.clearAllMocks();
    useGameFilterStore.getState()._reset();
    mockRegistryGames = [];
}

describe('CalendarPage — game toggle', () => {
    beforeEach(() => {
        mockIsDesktop = true;
        resetStore();
    });

    afterEach(() => {
        activeQueryClient?.clear();
    });

    it('unchecking a game in the panel deselects it', () => {
        render_page();
        deliver([makeGame('wow', 'World of Warcraft')]);

        openFilters();
        const checkbox = gameCheckbox('World of Warcraft');
        expect(checkbox).toBeChecked();

        fireEvent.click(checkbox);
        expect(checkbox).not.toBeChecked();
    });

    it('checking an unchecked game re-selects it', () => {
        render_page();
        deliver([makeGame('wow', 'World of Warcraft')]);

        openFilters();
        const checkbox = gameCheckbox('World of Warcraft');
        fireEvent.click(checkbox);
        expect(checkbox).not.toBeChecked();

        fireEvent.click(checkbox);
        expect(checkbox).toBeChecked();
    });

    it('toggling a game updates the funnel badge to the hidden count', () => {
        render_page();
        deliver(SIX_GAMES());

        openFilters();
        expect(gameCheckbox('Alpha')).toBeChecked();
        expect(screen.queryByTestId('filter-count-badge')).not.toBeInTheDocument();

        fireEvent.click(gameCheckbox('Alpha'));
        expect(gameCheckbox('Alpha')).not.toBeChecked();

        // Close with the funnel; the badge = games hidden (1 of 6).
        fireEvent.click(getFunnel());
        expect(getFunnel()).toHaveAttribute('aria-expanded', 'false');
        expect(screen.getByTestId('filter-count-badge')).toHaveTextContent('1');
        expect(getFunnel()).toHaveAccessibleDescription('1 game hidden');
    });
});

describe('CalendarPage — Clear all / None buttons', () => {
    beforeEach(() => {
        mockIsDesktop = true;
        resetStore();
    });

    afterEach(() => {
        activeQueryClient?.clear();
    });

    it('"Clear all" in the panel header selects all known games', () => {
        render_page();
        deliver([makeGame('a', 'Alpha'), makeGame('b', 'Beta'), makeGame('c', 'Gamma')]);

        openFilters();
        const dialog = getDialog();
        expect(within(dialog).queryByRole('button', { name: 'Clear all' })).not.toBeInTheDocument();

        fireEvent.click(gameCheckbox('Alpha'));
        expect(gameCheckbox('Alpha')).not.toBeChecked();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Clear all' }));

        within(dialog).getAllByRole('checkbox').forEach((cb) => expect(cb).toBeChecked());
        expect(within(dialog).queryByRole('button', { name: 'Clear all' })).not.toBeInTheDocument();
    });

    it('"None" button in the panel deselects all games', () => {
        render_page();
        deliver([makeGame('a', 'Alpha'), makeGame('b', 'Beta'), makeGame('c', 'Gamma')]);

        openFilters();
        const dialog = getDialog();

        fireEvent.click(within(dialog).getByRole('button', { name: 'None' }));

        within(dialog).getAllByRole('checkbox').forEach((cb) => expect(cb).not.toBeChecked());
    });

    it('"Clear all" restores every game after "None", badge = total hidden in between', () => {
        render_page();
        deliver(SIX_GAMES());

        openFilters();
        const dialog = getDialog();
        fireEvent.click(within(dialog).getByRole('button', { name: 'None' }));

        const checkboxes = within(dialog).getAllByRole('checkbox');
        expect(checkboxes).toHaveLength(6);
        checkboxes.forEach((cb) => expect(cb).not.toBeChecked());
        expect(screen.getByTestId('filter-count-badge')).toHaveTextContent('6');

        fireEvent.click(within(dialog).getByRole('button', { name: 'Clear all' }));

        checkboxes.forEach((cb) => expect(cb).toBeChecked());
        expect(screen.queryByTestId('filter-count-badge')).not.toBeInTheDocument();
    });
});

describe('CalendarPage — filter persistence when view changes — part 1', () => {
    beforeEach(() => {
        mockIsDesktop = true;
        resetStore();
    });
    afterEach(() => {
        activeQueryClient?.clear();
    });

    it('filter selections persist across re-renders with same games', () => {
        const { rerender } = render_page();
        deliver([makeGame('wow', 'World of Warcraft'), makeGame('apex', 'Apex Legends')]);

        openFilters();
        fireEvent.click(gameCheckbox(/World/));
        expect(gameCheckbox(/World/)).not.toBeChecked();

        // Close the panel (funnel) before rerender so the open state doesn't carry through.
        fireEvent.click(getFunnel());

        const rerenderQc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        rerender(
            <QueryClientProvider client={rerenderQc}>
                <MemoryRouter>
                    <CalendarPage />
                </MemoryRouter>
            </QueryClientProvider>,
        );

        // The store retained the deselection — verify by opening the panel again.
        openFilters();
        expect(gameCheckbox(/World/)).not.toBeChecked();
        expect(gameCheckbox(/Apex/)).toBeChecked();
    });
});

describe('CalendarPage — filter persistence when view changes — part 2', () => {
    beforeEach(() => {
        mockIsDesktop = true;
        resetStore();
    });
    afterEach(() => {
        activeQueryClient?.clear();
    });

    it('filter selections survive component unmount/remount (ROK-372 regression)', () => {
        const { unmount } = render_page();
        deliver([makeGame('wow', 'World of Warcraft'), makeGame('apex', 'Apex Legends')]);

        openFilters();
        fireEvent.click(gameCheckbox(/World/));
        expect(gameCheckbox(/World/)).not.toBeChecked();

        unmount();
        render_page();
        deliver([makeGame('wow', 'World of Warcraft'), makeGame('apex', 'Apex Legends')]);

        openFilters();
        expect(gameCheckbox(/World/)).not.toBeChecked();
        expect(gameCheckbox(/Apex/)).toBeChecked();
    });

    it('filter selections persist when same games are re-reported (month change scenario)', () => {
        render_page();
        deliver([makeGame('wow', 'World of Warcraft'), makeGame('apex', 'Apex Legends')]);

        openFilters();
        fireEvent.click(gameCheckbox(/World/));

        deliver([]);
        deliver([makeGame('wow', 'World of Warcraft'), makeGame('apex', 'Apex Legends')]);

        // Panel is still open and re-renders with same data.
        expect(gameCheckbox(/World/)).not.toBeChecked();
    });
});

describe('CalendarPage — filter persistence when view changes — part 3', () => {
    beforeEach(() => {
        mockIsDesktop = true;
        resetStore();
    });
    afterEach(() => {
        activeQueryClient?.clear();
    });

    it('games do not get removed from allKnownGames when a different date range is loaded', () => {
        render_page();
        deliver([makeGame('wow', 'World of Warcraft')]);
        deliver([makeGame('apex', 'Apex Legends')]);

        openFilters();
        expect(gameCheckbox('Apex Legends')).toBeInTheDocument();
        expect(gameCheckbox('World of Warcraft')).toBeInTheDocument();
    });
});

describe('CalendarPage — Filters FAB and BottomSheet (below 1024px)', () => {
    beforeEach(() => {
        mockIsDesktop = false;
        resetStore();
    });

    afterEach(() => {
        activeQueryClient?.clear();
    });

    it('Filters FAB is not rendered before any games arrive', () => {
        render_page();
        expect(screen.queryByTestId('filter-fab')).not.toBeInTheDocument();
    });

    it('Filters FAB appears after games arrive, and there is no toolbar funnel', () => {
        mockRegistryGames = [makeRegistryGame('wow', 'World of Warcraft')];
        render_page();
        expect(screen.getByTestId('filter-fab')).toHaveAccessibleName('Filters');
        expect(screen.queryByTestId('filter-panel-trigger')).not.toBeInTheDocument();
    });

    it('clicking the Filters FAB opens the bottom sheet', () => {
        mockRegistryGames = [makeRegistryGame('wow', 'World of Warcraft')];
        render_page();

        fireEvent.click(screen.getByTestId('filter-fab'));

        expect(screen.getByTestId('bottom-sheet')).toHaveAttribute('data-open', 'true');
        expect(screen.getByTestId('filter-fab')).toHaveAttribute('aria-expanded', 'true');
    });

    it('bottom sheet is initially closed', () => {
        mockRegistryGames = [makeRegistryGame('wow', 'World of Warcraft')];
        render_page();

        expect(screen.getByTestId('bottom-sheet')).toHaveAttribute('data-open', 'false');
    });

    it('bottom sheet lists every game as a pressed tap row', () => {
        render_page();
        deliver(SIX_GAMES());

        const sheet = screen.getByTestId('bottom-sheet');
        for (const name of ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Foxtrot']) {
            expect(within(sheet).getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');
        }
    });

    it('bottom sheet shows count of selected vs total games; FAB badge = games hidden', () => {
        render_page();
        deliver([makeGame('a', 'Alpha'), makeGame('b', 'Beta'), makeGame('c', 'Gamma')]);

        const sheet = screen.getByTestId('bottom-sheet');
        expect(sheet).toHaveTextContent(/3 of 3 selected/i);

        fireEvent.click(within(sheet).getByRole('button', { name: 'Beta' }));
        expect(sheet).toHaveTextContent(/2 of 3 selected/i);
        expect(within(screen.getByTestId('filter-fab')).getByTestId('filter-count-badge')).toHaveTextContent('1');
        expect(screen.getByTestId('filter-fab')).toHaveAccessibleDescription('1 game hidden');
    });
});

describe('CalendarPage — useGameRegistry integration (ROK-650)', () => {
    beforeEach(() => {
        mockIsDesktop = true;
        vi.clearAllMocks();
        useGameFilterStore.getState()._reset();
        mockRegistryGames = [];
    });

    afterEach(() => {
        activeQueryClient?.clear();
    });

    it('populates game filter from game registry on mount', () => {
        mockRegistryGames = [
            makeRegistryGame('wow', 'World of Warcraft', 1),
            makeRegistryGame('ff14', 'Final Fantasy XIV', 2),
            makeRegistryGame('gw2', 'Guild Wars 2', 3),
        ];
        render_page();

        openFilters();
        const dialog = getDialog();
        const gameNames = within(dialog).getAllByRole('checkbox').map(
            nameOf,
        );
        expect(gameNames).toContain('World of Warcraft');
        expect(gameNames).toContain('Final Fantasy XIV');
        expect(gameNames).toContain('Guild Wars 2');
        expect(gameNames.length).toBe(3);
    });

    it('shows all registry games even when no events exist for some games', () => {
        mockRegistryGames = [
            makeRegistryGame('wow', 'World of Warcraft', 1),
            makeRegistryGame('ff14', 'Final Fantasy XIV', 2),
            makeRegistryGame('gw2', 'Guild Wars 2', 3),
        ];
        render_page();

        openFilters();
        const dialog = getDialog();
        const checkboxes = within(dialog).getAllByRole('checkbox');
        expect(checkboxes).toHaveLength(3);
        checkboxes.forEach((cb) => expect(cb).toBeChecked());
    });
});

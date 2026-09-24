import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
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
function getChip(): HTMLElement {
    return screen.getByTestId('filter-panel-trigger');
}

function openModalViaChip() {
    fireEvent.click(getChip());
}

/** A checkbox row's accessible name: its aria-labelledby text minus aria-hidden decoration (the emoji). */
function nameOf(cb: HTMLElement): string {
    const label = document.getElementById(cb.getAttribute('aria-labelledby') ?? '')?.cloneNode(true) as HTMLElement | undefined;
    label?.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
    return label?.textContent ?? '';
}

/** Game names of the panel's checkbox rows, in DOM order (the Checkbox primitive labels via aria-labelledby). */
function checkboxNames(): string[] {
    return within(screen.getByTestId('filter-panel')).getAllByRole('checkbox').map(nameOf);
}

function resetStore() {
    mockIsDesktop = true;
    vi.clearAllMocks();
    useGameFilterStore.getState()._reset();
    mockRegistryGames = [];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function accumulatorTestsGroup1() {
    it('renders the calendar view', () => {
        render_page();
        expect(screen.getByTestId('calendar-view')).toBeInTheDocument();
    });

    it('filter funnel is hidden before any games arrive', () => {
        render_page();
        expect(screen.queryByTestId('filter-panel-trigger')).toBeNull();
    });

    it('shows the filter funnel after games arrive', () => {
        mockRegistryGames = [makeRegistryGame('wow', 'World of Warcraft')];
        render_page();
        expect(screen.getByTestId('filter-panel-trigger')).toHaveAccessibleName('Filters');
    });

    it('no control is still named "Filter by Game" (ROK-1662 retired it)', () => {
        mockRegistryGames = [makeRegistryGame('wow', 'World of Warcraft')];
        render_page();
        expect(screen.queryByRole('button', { name: /filter by game/i })).toBeNull();
        expect(screen.queryByText(/filter by game/i)).toBeNull();
    });
}

function accumulatorTestsGroup2() {
    it('accumulates games across multiple calls (no duplicates)', () => {
        render_page();
        deliver([makeGame('wow', 'World of Warcraft'), makeGame('ff14', 'Final Fantasy XIV')]);
        deliver([makeGame('wow', 'World of Warcraft'), makeGame('gw2', 'Guild Wars 2')]);

        openModalViaChip();
        const gameNames = checkboxNames();
        expect(gameNames).toContain('World of Warcraft');
        expect(gameNames).toContain('Final Fantasy XIV');
        expect(gameNames).toContain('Guild Wars 2');
        expect(gameNames.length).toBe(3);
    });

    it('does not duplicate games when same slug appears multiple times', () => {
        render_page();
        deliver([makeGame('wow', 'World of Warcraft')]);
        deliver([makeGame('wow', 'World of Warcraft')]);

        openModalViaChip();
        expect(within(screen.getByTestId('filter-panel')).getAllByRole('checkbox')).toHaveLength(1);
    });

    it('sorts games alphabetically inside the filter panel', () => {
        render_page();
        deliver([
            makeGame('wow', 'World of Warcraft'),
            makeGame('apex', 'Apex Legends'),
            makeGame('ff14', 'Final Fantasy XIV'),
        ]);

        openModalViaChip();
        expect(checkboxNames()).toEqual(['Apex Legends', 'Final Fantasy XIV', 'World of Warcraft']);
    });
}

describe('CalendarPage — allKnownGames accumulator', () => {
    beforeEach(resetStore);

    afterEach(() => {
        activeQueryClient?.clear();
    });

    accumulatorTestsGroup1();
    accumulatorTestsGroup2();
});

describe('CalendarPage — auto-select behaviour', () => {
    beforeEach(resetStore);

    afterEach(() => {
        activeQueryClient?.clear();
    });

    it('auto-selects all games on first delivery', () => {
        mockRegistryGames = [
            makeRegistryGame('wow', 'World of Warcraft', 1),
            makeRegistryGame('apex', 'Apex Legends', 2),
        ];
        render_page();

        openModalViaChip();
        const checkboxes = within(screen.getByTestId('filter-panel')).getAllByRole('checkbox');
        expect(checkboxes).toHaveLength(2);
        checkboxes.forEach((cb) => expect(cb).toBeChecked());
    });

    it('does NOT auto-select new games from subsequent deliveries', () => {
        render_page();
        deliver([makeGame('wow', 'World of Warcraft')]);

        openModalViaChip();
        const panel = screen.getByTestId('filter-panel');
        const wowCheckbox = within(panel).getByRole('checkbox', { name: 'World of Warcraft' });
        fireEvent.click(wowCheckbox);
        expect(wowCheckbox).not.toBeChecked();

        deliver([makeGame('apex', 'Apex Legends')]);

        expect(within(panel).getByRole('checkbox', { name: 'Apex Legends' })).not.toBeChecked();
    });
});

describe('CalendarPage — funnel badge (games hidden)', () => {
    beforeEach(resetStore);

    afterEach(() => {
        activeQueryClient?.clear();
    });

    it('no badge while every game is selected', () => {
        mockRegistryGames = [makeRegistryGame('wow', 'World of Warcraft'), makeRegistryGame('apex', 'Apex Legends', 2)];
        render_page();

        expect(screen.queryByTestId('filter-count-badge')).toBeNull();
        expect(getChip()).not.toHaveAttribute('aria-describedby');
    });

    it('badge = every game after "None" (CalendarView shows zero events)', () => {
        render_page();
        deliver([makeGame('wow', 'World of Warcraft'), makeGame('apex', 'Apex Legends')]);

        openModalViaChip();
        fireEvent.click(within(screen.getByTestId('filter-panel')).getByRole('button', { name: 'None' }));
        fireEvent.click(getChip());

        expect(screen.getByTestId('filter-count-badge')).toHaveTextContent('2');
        expect(getChip()).toHaveAccessibleDescription('2 games hidden');
    });

    it('badge = number of games hidden on a partial selection', () => {
        render_page();
        deliver([makeGame('wow', 'World of Warcraft'), makeGame('apex', 'Apex Legends'), makeGame('ff14', 'FFXIV')]);

        openModalViaChip();
        fireEvent.click(within(screen.getByTestId('filter-panel')).getByRole('checkbox', { name: 'Apex Legends' }));
        fireEvent.click(getChip());

        expect(screen.getByTestId('filter-count-badge')).toHaveTextContent('1');
        expect(getChip()).toHaveAccessibleDescription('1 game hidden');
    });

    it('clicking the funnel opens the filter panel', () => {
        render_page();
        deliver([makeGame('wow', 'World of Warcraft')]);

        expect(getChip()).toHaveAttribute('aria-expanded', 'false');
        expect(screen.getByTestId('filter-panel')).toHaveAttribute('aria-hidden', 'true');
        openModalViaChip();
        expect(getChip()).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByTestId('filter-panel')).not.toHaveAttribute('aria-hidden');
    });

    it('funnel is hidden when no games are known', () => {
        render_page();
        expect(screen.queryByTestId('filter-panel-trigger')).toBeNull();
    });

    it('no toolbar funnel below 1024px (the Filters FAB opens filters there)', () => {
        mockIsDesktop = false;
        mockRegistryGames = [makeRegistryGame('wow', 'World of Warcraft')];
        render_page();
        expect(screen.queryByTestId('filter-panel-trigger')).toBeNull();
        expect(screen.getByTestId('filter-fab')).toBeInTheDocument();
    });
});

function setupWithGames() {
    render_page();
    deliver([
        makeGame('a', 'Alpha'),
        makeGame('b', 'Beta'),
        makeGame('c', 'Gamma'),
        makeGame('d', 'Delta'),
        makeGame('e', 'Epsilon'),
        makeGame('f', 'Foxtrot'),
    ]);
}

function openModal() {
    setupWithGames();
    openModalViaChip();
}

function panelTestsGroup1() {
    it('filter panel is collapsed initially', () => {
        setupWithGames();
        expect(getChip()).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('checkbox', { name: 'Alpha' })).toBeNull();
    });

    it('opens the filter panel when the funnel is clicked', () => {
        openModal();
        expect(screen.getByRole('checkbox', { name: 'Alpha' })).toBeInTheDocument();
    });

    it('panel shows all games', () => {
        openModal();
        expect(checkboxNames()).toHaveLength(6);
    });
}

function panelTestsGroup2() {
    it('panel heading is "Filters"', () => {
        openModal();
        const panel = screen.getByTestId('filter-panel');
        expect(within(panel).getByRole('heading', { name: 'Filters' })).toBeInTheDocument();
    });

    it('panel collapses when the funnel is clicked again', () => {
        openModal();
        fireEvent.click(getChip());
        expect(getChip()).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('checkbox', { name: 'Alpha' })).toBeNull();
    });

    it('Escape collapses the panel and returns focus to the funnel', () => {
        openModal();
        const alpha = screen.getByRole('checkbox', { name: 'Alpha' });
        alpha.focus();
        expect(document.activeElement).toBe(alpha);

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(getChip()).toHaveAttribute('aria-expanded', 'false');
        expect(document.activeElement).toBe(getChip());
    });
}

function panelTestsGroup3() {
    it('"Clear all" shows only while a game is hidden; "None" is always there', () => {
        openModal();
        const panel = screen.getByTestId('filter-panel');
        expect(within(panel).getByRole('button', { name: 'None' })).toBeInTheDocument();
        expect(within(panel).queryByRole('button', { name: 'Clear all' })).toBeNull();

        fireEvent.click(within(panel).getByRole('checkbox', { name: 'Beta' }));
        expect(within(panel).getByRole('button', { name: 'Clear all' })).toBeInTheDocument();
    });

    it('panel shows games sorted alphabetically', () => {
        openModal();
        expect(checkboxNames()).toEqual(['Alpha', 'Beta', 'Delta', 'Epsilon', 'Foxtrot', 'Gamma']);
    });
}

describe('CalendarPage — filter panel (desktop)', () => {
    beforeEach(resetStore);

    afterEach(() => {
        activeQueryClient?.clear();
    });

    panelTestsGroup1();
    panelTestsGroup2();
    panelTestsGroup3();
});

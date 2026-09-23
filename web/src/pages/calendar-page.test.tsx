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

/** Open the desktop filter modal by clicking the [Filter: …] chip.
 * Note: the mobile FAB also has aria-label "Filter by Game"; we use the
 * .calendar-filter-chip class to disambiguate. */
function getChip(): HTMLElement {
    return screen.getByTestId('filter-panel-trigger');
}

function openModalViaChip() {
    fireEvent.click(getChip());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function accumulatorTestsGroup1() {
    it('renders the calendar view', () => {
        render_page();
        expect(screen.getByTestId('calendar-view')).toBeInTheDocument();
    });

    it('filter chip is hidden before any games arrive', () => {
        render_page();
        expect(screen.queryByTestId('filter-panel-trigger')).toBeNull();
    });

    it('shows filter chip after games arrive', () => {
        mockRegistryGames = [makeRegistryGame('wow', 'World of Warcraft')];
        render_page();
        expect(screen.queryByTestId('filter-panel-trigger')).not.toBeNull();
    });
}

function accumulatorTestsGroup2() {
    it('accumulates games across multiple calls (no duplicates)', () => {
        render_page();
        deliver([makeGame('wow', 'World of Warcraft'), makeGame('ff14', 'Final Fantasy XIV')]);
        deliver([makeGame('wow', 'World of Warcraft'), makeGame('gw2', 'Guild Wars 2')]);

        openModalViaChip();
        const dialog = screen.getByTestId('filter-panel');
        const gameNames = Array.from(dialog.querySelectorAll('input[type="checkbox"]')).map(
            (cb) => (cb.closest('label') as HTMLElement | null)?.querySelector('.game-filter-name')?.textContent ?? '',
        );
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
        const dialog = screen.getByTestId('filter-panel');
        const checkboxes = within(dialog).getAllByRole('checkbox');
        expect(checkboxes).toHaveLength(1);
    });

    it('sorts games alphabetically inside the filter modal', () => {
        render_page();
        deliver([
            makeGame('wow', 'World of Warcraft'),
            makeGame('apex', 'Apex Legends'),
            makeGame('ff14', 'Final Fantasy XIV'),
        ]);

        openModalViaChip();
        const dialog = screen.getByTestId('filter-panel');
        const labels = Array.from(dialog.querySelectorAll('input[type="checkbox"]'))
            .map((cb) => (cb.closest('label') as HTMLElement | null)?.querySelector('.game-filter-name')?.textContent ?? '');

        expect(labels[0]).toBe('Apex Legends');
        expect(labels[1]).toBe('Final Fantasy XIV');
        expect(labels[2]).toBe('World of Warcraft');
    });
}

describe('CalendarPage — allKnownGames accumulator', () => {
    beforeEach(() => {
        mockIsDesktop = true;
        vi.clearAllMocks();
        useGameFilterStore.getState()._reset();
        mockRegistryGames = [];
    });

    afterEach(() => {
        activeQueryClient?.clear();
    });

    accumulatorTestsGroup1();
    accumulatorTestsGroup2();
});

describe('CalendarPage — auto-select behaviour', () => {
    beforeEach(() => {
        mockIsDesktop = true;
        vi.clearAllMocks();
        useGameFilterStore.getState()._reset();
        mockRegistryGames = [];
    });

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
        const dialog = screen.getByTestId('filter-panel');
        const checkboxes = within(dialog).getAllByRole('checkbox');
        checkboxes.forEach((cb) => expect(cb).toBeChecked());
    });

    it('does NOT auto-select new games from subsequent deliveries', () => {
        render_page();
        deliver([makeGame('wow', 'World of Warcraft')]);

        openModalViaChip();
        const dialog = screen.getByTestId('filter-panel');
        const wowCheckbox = within(dialog).getByRole('checkbox');
        fireEvent.change(wowCheckbox, { target: { checked: false } });
        expect(wowCheckbox).not.toBeChecked();

        deliver([makeGame('apex', 'Apex Legends')]);

        const updatedCheckboxes = within(screen.getByTestId('filter-panel')).getAllByRole('checkbox');
        const apexCb = updatedCheckboxes.find(
            (cb) => (cb.closest('label') as HTMLElement | null)?.querySelector('.game-filter-name')?.textContent === 'Apex Legends',
        );
        expect(apexCb).not.toBeChecked();
    });
});

describe('CalendarPage — filter chip', () => {
    beforeEach(() => {
        mockIsDesktop = true;
        vi.clearAllMocks();
        useGameFilterStore.getState()._reset();
        mockRegistryGames = [];
    });

    afterEach(() => {
        activeQueryClient?.clear();
    });

    it('chip label reads "Filter: All games" when every game is selected', () => {
        mockRegistryGames = [makeRegistryGame('wow', 'World of Warcraft'), makeRegistryGame('apex', 'Apex Legends', 2)];
        render_page();

        expect(screen.queryByTestId('filter-count-badge')).toBeNull();
    });

    it('chip label reads "Filter: No games" when user clicks None (CalendarView shows zero events)', () => {
        render_page();
        deliver([makeGame('wow', 'World of Warcraft'), makeGame('apex', 'Apex Legends')]);

        openModalViaChip();
        const dialog = screen.getByTestId('filter-panel');
        const noneBtn = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'None');
        fireEvent.click(noneBtn!);
        fireEvent.click(screen.getByRole('button', { name: 'Close modal' }));

        expect(screen.getByTestId('filter-count-badge')).toHaveTextContent(String(useGameFilterStore.getState().allKnownGames.length));
    });

    it('chip label reads "Filter: N games" when partial selection', () => {
        render_page();
        deliver([makeGame('wow', 'World of Warcraft'), makeGame('apex', 'Apex Legends'), makeGame('ff14', 'FFXIV')]);

        openModalViaChip();
        const dialog = screen.getByTestId('filter-panel');
        const apexLabel = Array.from(dialog.querySelectorAll('label.game-filter-item')).find(
            (lbl) => lbl.querySelector('.game-filter-name')?.textContent === 'Apex Legends',
        ) as HTMLElement | undefined;
        expect(apexLabel).toBeDefined();
        fireEvent.click(apexLabel!);

        fireEvent.click(screen.getByRole('button', { name: 'Close modal' }));

        expect(screen.getByTestId('filter-count-badge')).toHaveTextContent(String(useGameFilterStore.getState().allKnownGames.length - 2));
    });

    it('clicking the chip opens the filter modal', () => {
        render_page();
        deliver([makeGame('wow', 'World of Warcraft')]);

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        openModalViaChip();
        expect(screen.getByTestId('filter-panel')).toBeInTheDocument();
    });

    it('chip is hidden when no games are known', () => {
        render_page();
        expect(screen.queryByTestId('filter-panel-trigger')).toBeNull();
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

function modalOverflowTestsGroup1() {
    it('filter modal is not visible initially', () => {
        setupWithGames();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('opens filter modal when the chip is clicked', () => {
        openModal();
        expect(screen.getByTestId('filter-panel')).toBeInTheDocument();
    });

    it('modal shows all games', () => {
        openModal();
        const dialog = screen.getByTestId('filter-panel');
        expect(dialog).toHaveTextContent('Alpha');
        expect(dialog).toHaveTextContent('Beta');
        expect(dialog).toHaveTextContent('Gamma');
        expect(dialog).toHaveTextContent('Delta');
        expect(dialog).toHaveTextContent('Epsilon');
        expect(dialog).toHaveTextContent('Foxtrot');
    });
}

function modalOverflowTestsGroup2() {
    it('modal title is "Filter by Game"', () => {
        openModal();
        const dialog = screen.getByTestId('filter-panel');
        expect(dialog).toHaveTextContent('Filter by Game');
    });

    it('modal closes when close button (X) is clicked', () => {
        openModal();
        const closeBtn = screen.getByRole('button', { name: 'Close modal' });
        fireEvent.click(closeBtn);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('modal closes on Escape key', () => {
        openModal();
        expect(screen.getByTestId('filter-panel')).toBeInTheDocument();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
}

function modalOverflowTestsGroup3() {
    it('modal closes when backdrop is clicked', () => {
        openModal();
        const dialog = screen.getByTestId('filter-panel');
        const backdrop = dialog.parentElement?.querySelector('[aria-hidden="true"]') as HTMLElement | null;
        expect(backdrop).toBeTruthy();
        fireEvent.click(backdrop!);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('modal has All and None buttons', () => {
        openModal();
        const dialog = screen.getByTestId('filter-panel');
        const buttons = Array.from(dialog.querySelectorAll('button'));
        expect(buttons.find((b) => b.textContent === 'All')).toBeTruthy();
        expect(buttons.find((b) => b.textContent === 'None')).toBeTruthy();
    });

    it('modal shows games sorted alphabetically', () => {
        openModal();
        const dialog = screen.getByTestId('filter-panel');
        const checkboxes = Array.from(dialog.querySelectorAll('input[type="checkbox"]'));
        const names = checkboxes.map(
            (cb) => (cb.closest('label') as HTMLElement | null)?.querySelector('.game-filter-name')?.textContent ?? '',
        );
        expect(names[0]).toBe('Alpha');
        expect(names[1]).toBe('Beta');
        expect(names[2]).toBe('Delta');
        expect(names[3]).toBe('Epsilon');
        expect(names[4]).toBe('Foxtrot');
        expect(names[5]).toBe('Gamma');
    });
}

describe('CalendarPage — filter modal (desktop overflow)', () => {
    beforeEach(() => {
        mockIsDesktop = true;
        vi.clearAllMocks();
        useGameFilterStore.getState()._reset();
        mockRegistryGames = [];
    });

    afterEach(() => {
        activeQueryClient?.clear();
    });

    modalOverflowTestsGroup1();
    modalOverflowTestsGroup2();
    modalOverflowTestsGroup3();
});

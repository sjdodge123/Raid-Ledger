import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { makeGame, makeRegistryGame, renderPage, deliverGames } from './calendar-page.test-helpers';

// ---------------------------------------------------------------------------
// Module mocks — must be declared before the component import
// ---------------------------------------------------------------------------

vi.mock('../hooks/use-auth', () => ({
    useAuth: () => ({ isAuthenticated: false, user: null }),
}));

vi.mock('../hooks/use-game-time', () => ({
    useGameTime: () => ({ data: null }),
}));

let mockRegistryGames: ReturnType<typeof makeRegistryGame>[] = [];
vi.mock('../hooks/use-game-registry', () => ({
    useGameRegistry: () => ({ games: mockRegistryGames, isLoading: false, error: null }),
}));

vi.mock('../components/calendar', () => ({
    CalendarView: () => <div data-testid="calendar-view" />,
    MiniCalendar: () => <div data-testid="mini-calendar" />,
}));

vi.mock('../components/calendar/calendar-mobile-toolbar', () => ({
    CalendarMobileToolbar: () => <div data-testid="mobile-toolbar" />,
}));

vi.mock('../components/calendar/calendar-mobile-nav', () => ({
    CalendarMobileNav: () => <div data-testid="mobile-nav" />,
}));

vi.mock('../components/ui/fab', () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    FAB: (props: any) => (
        <button data-testid="fab" onClick={props.onClick} aria-label={props.label}>
            FAB
        </button>
    ),
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CalendarPage — allKnownGames accumulator', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useGameFilterStore.getState()._reset();
        mockRegistryGames = [];
    });

    afterEach(() => {
        activeQueryClient?.clear();
    });

    it('renders the calendar view', () => {
        render_page();
        expect(screen.getByTestId('calendar-view')).toBeInTheDocument();
    });

    it('game filter section is hidden before any games arrive', () => {
        render_page();
        expect(screen.queryByText('Filter by Game')).not.toBeInTheDocument();
    });

    it('shows game filter section after games arrive', () => {
        mockRegistryGames = [makeRegistryGame('wow', 'World of Warcraft')];
        render_page();
        expect(screen.getAllByText('Filter by Game').length).toBeGreaterThan(0);
    });

    it('accumulates games across multiple calls (no duplicates)', () => {
        render_page();
        deliver([makeGame('wow', 'World of Warcraft'), makeGame('ff14', 'Final Fantasy XIV')]);
        deliver([makeGame('wow', 'World of Warcraft'), makeGame('gw2', 'Guild Wars 2')]);

        const gameNames = screen.getAllByRole('checkbox').map(
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

        const checkboxes = screen.getAllByRole('checkbox');
        expect(checkboxes).toHaveLength(1);
    });

    it('sorts games alphabetically', () => {
        render_page();
        deliver([
            makeGame('wow', 'World of Warcraft'),
            makeGame('apex', 'Apex Legends'),
            makeGame('ff14', 'Final Fantasy XIV'),
        ]);

        const labels = screen
            .getAllByRole('checkbox')
            .map((cb) => (cb.closest('label') as HTMLElement | null)?.querySelector('.game-filter-name')?.textContent ?? '');

        expect(labels[0]).toBe('Apex Legends');
        expect(labels[1]).toBe('Final Fantasy XIV');
        expect(labels[2]).toBe('World of Warcraft');
    });
});

describe('CalendarPage — auto-select behaviour', () => {
    beforeEach(() => {
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

        const checkboxes = screen.getAllByRole('checkbox');
        checkboxes.forEach((cb) => expect(cb).toBeChecked());
    });

    it('does NOT auto-select new games from subsequent deliveries', () => {
        render_page();
        deliver([makeGame('wow', 'World of Warcraft')]);

        const wowCheckbox = screen.getByRole('checkbox');
        fireEvent.change(wowCheckbox, { target: { checked: false } });
        expect(wowCheckbox).not.toBeChecked();

        deliver([makeGame('apex', 'Apex Legends')]);

        const checkboxes = screen.getAllByRole('checkbox');
        const apexCb = checkboxes.find(
            (cb) => (cb.closest('label') as HTMLElement | null)?.querySelector('.game-filter-name')?.textContent === 'Apex Legends',
        );
        expect(apexCb).not.toBeChecked();
    });
});

describe('CalendarPage — inline list capping (maxVisible=5)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useGameFilterStore.getState()._reset();
        mockRegistryGames = [];
    });

    afterEach(() => {
        activeQueryClient?.clear();
    });

    it('shows all games inline when count <= maxVisible (5)', () => {
        render_page();
        deliver([
            makeGame('a', 'Alpha'),
            makeGame('b', 'Beta'),
            makeGame('c', 'Gamma'),
            makeGame('d', 'Delta'),
            makeGame('e', 'Epsilon'),
        ]);

        const checkboxes = screen.getAllByRole('checkbox');
        expect(checkboxes).toHaveLength(5);

        expect(screen.queryByText(/Show all/i)).not.toBeInTheDocument();
    });

    it('shows "Show all N games..." button when count > maxVisible', () => {
        render_page();
        deliver([
            makeGame('a', 'Alpha'),
            makeGame('b', 'Beta'),
            makeGame('c', 'Gamma'),
            makeGame('d', 'Delta'),
            makeGame('e', 'Epsilon'),
            makeGame('f', 'Foxtrot'),
        ]);

        expect(screen.getByText(/Show all 6 games/i)).toBeInTheDocument();
    });

    it('only shows maxVisible (5) items inline when overflow', () => {
        render_page();
        deliver([
            makeGame('a', 'Alpha'),
            makeGame('b', 'Beta'),
            makeGame('c', 'Gamma'),
            makeGame('d', 'Delta'),
            makeGame('e', 'Epsilon'),
            makeGame('f', 'Foxtrot'),
        ]);

        const checkboxes = screen.getAllByRole('checkbox');
        expect(checkboxes).toHaveLength(5);
    });

    it('"Show all" button count reflects total game count including overflow', () => {
        render_page();
        deliver([
            makeGame('a', 'Alpha'),
            makeGame('b', 'Beta'),
            makeGame('c', 'Gamma'),
            makeGame('d', 'Delta'),
            makeGame('e', 'Epsilon'),
            makeGame('f', 'Foxtrot'),
            makeGame('g', 'Golf'),
        ]);

        expect(screen.getByText(/Show all 7 games/i)).toBeInTheDocument();
    });
});

describe('CalendarPage — filter modal (overflow)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useGameFilterStore.getState()._reset();
        mockRegistryGames = [];
    });

    afterEach(() => {
        activeQueryClient?.clear();
    });

    function setupWithOverflow() {
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
        setupWithOverflow();
        const showAllBtn = screen.getByText(/Show all/i);
        fireEvent.click(showAllBtn);
    }

    it('filter modal is not visible initially', () => {
        setupWithOverflow();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('opens filter modal when "Show all" is clicked', () => {
        openModal();
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('modal shows all games (not just capped list)', () => {
        openModal();
        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveTextContent('Alpha');
        expect(dialog).toHaveTextContent('Beta');
        expect(dialog).toHaveTextContent('Gamma');
        expect(dialog).toHaveTextContent('Delta');
        expect(dialog).toHaveTextContent('Epsilon');
        expect(dialog).toHaveTextContent('Foxtrot');
    });

    it('modal title is "Filter by Game"', () => {
        openModal();
        const dialog = screen.getByRole('dialog');
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
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('modal closes when backdrop is clicked', () => {
        openModal();
        const dialog = screen.getByRole('dialog');
        const backdrop = dialog.parentElement?.querySelector('[aria-hidden="true"]') as HTMLElement | null;
        expect(backdrop).toBeTruthy();
        fireEvent.click(backdrop!);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('modal has All and None buttons', () => {
        openModal();
        const dialog = screen.getByRole('dialog');
        const buttons = Array.from(dialog.querySelectorAll('button'));
        expect(buttons.find((b) => b.textContent === 'All')).toBeTruthy();
        expect(buttons.find((b) => b.textContent === 'None')).toBeTruthy();
    });

    it('modal shows games sorted alphabetically', () => {
        openModal();
        const dialog = screen.getByRole('dialog');
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
});

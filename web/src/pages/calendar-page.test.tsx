import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { GameInfo } from '../stores/game-filter-store';

// ---------------------------------------------------------------------------
// Module mocks — must be declared before the component import
// ---------------------------------------------------------------------------

vi.mock('../hooks/use-auth', () => ({
    useAuth: () => ({ isAuthenticated: false, user: null }),
}));

vi.mock('../hooks/use-game-time', () => ({
    useGameTime: () => ({ data: null }),
}));

// Stub out the heavy CalendarView; expose onGamesAvailable so tests can call it
let capturedOnGamesAvailable: ((games: GameInfo[]) => void) | null = null;
vi.mock('../components/calendar', () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    CalendarView: (props: any) => {
        capturedOnGamesAvailable = props.onGamesAvailable ?? null;
        return <div data-testid="calendar-view" />;
    },
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

// BottomSheet mock — using data-testid="bottom-sheet" (NOT role="dialog") to avoid
// conflicts with the real Modal which uses role="dialog"
vi.mock('../components/ui/bottom-sheet', () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    BottomSheet: (props: any) => (
        <div data-testid="bottom-sheet" data-open={props.isOpen ? 'true' : 'false'}>
            <button data-testid="bottom-sheet-close" onClick={props.onClose}>Close Sheet</button>
            {props.children}
        </div>
    ),
}));

// Use the real Modal so we can test its open/close behaviour

vi.mock('../constants/game-colors', () => ({
    getGameColors: () => ({ bg: '#fff', border: '#ccc', icon: '🎮' }),
}));

// Suppress CSS import
vi.mock('../components/calendar/calendar-styles.css', () => ({}));

// Mock useFocusTrap to eliminate requestAnimationFrame timing issues
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

const makeGame = (slug: string, name: string) => ({ slug, name, coverUrl: null });

let activeQueryClient: QueryClient;

function renderPage() {
    activeQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    capturedOnGamesAvailable = null;
    return render(
        <QueryClientProvider client={activeQueryClient}>
            <MemoryRouter>
                <CalendarPage />
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

// Deliver games to the calendar page via the CalendarView callback
function deliverGames(games: ReturnType<typeof makeGame>[]) {
    act(() => {
        capturedOnGamesAvailable?.(games);
    });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CalendarPage — allKnownGames accumulator', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useGameFilterStore.getState()._reset();
    });

    afterEach(() => {
        activeQueryClient?.clear();
    });

    it('renders the calendar view', () => {
        renderPage();
        expect(screen.getByTestId('calendar-view')).toBeInTheDocument();
    });

    it('game filter section is hidden before any games arrive', () => {
        renderPage();
        // No game filter labels should appear
        expect(screen.queryByText('Filter by Game')).not.toBeInTheDocument();
    });

    it('shows game filter section after games arrive', () => {
        renderPage();
        deliverGames([makeGame('wow', 'World of Warcraft')]);
        // "Filter by Game" header should appear in the sidebar section
        expect(screen.getAllByText('Filter by Game').length).toBeGreaterThan(0);
    });

    it('accumulates games across multiple calls (no duplicates)', () => {
        renderPage();
        deliverGames([makeGame('wow', 'World of Warcraft'), makeGame('ff14', 'Final Fantasy XIV')]);
        deliverGames([makeGame('wow', 'World of Warcraft'), makeGame('gw2', 'Guild Wars 2')]);

        // All three unique games should be visible (cap=3, sorted: FF14, GW2, WoW → all 3 fit)
        const gameNames = screen.getAllByRole('checkbox').map(
            (cb) => (cb.closest('label') as HTMLElement | null)?.querySelector('.game-filter-name')?.textContent ?? '',
        );
        expect(gameNames).toContain('World of Warcraft');
        expect(gameNames).toContain('Final Fantasy XIV');
        expect(gameNames).toContain('Guild Wars 2');
        // Exactly 3 checkboxes in the inline list (cap=3, exactly 3 unique games)
        expect(gameNames.length).toBe(3);
    });

    it('does not duplicate games when same slug appears multiple times', () => {
        renderPage();
        deliverGames([makeGame('wow', 'World of Warcraft')]);
        deliverGames([makeGame('wow', 'World of Warcraft')]);

        // Only 1 checkbox in the inline list
        const checkboxes = screen.getAllByRole('checkbox');
        expect(checkboxes).toHaveLength(1);
    });

    it('sorts games alphabetically', () => {
        renderPage();
        // Deliver in reverse alphabetical order
        deliverGames([
            makeGame('wow', 'World of Warcraft'),
            makeGame('apex', 'Apex Legends'),
            makeGame('ff14', 'Final Fantasy XIV'),
        ]);

        // All three games visible inline (cap=3, exactly 3)
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
    });

    afterEach(() => {
        activeQueryClient?.clear();
    });

    it('auto-selects all games on first delivery', () => {
        renderPage();
        deliverGames([makeGame('wow', 'World of Warcraft'), makeGame('apex', 'Apex Legends')]);

        // Both checkboxes should be checked
        const checkboxes = screen.getAllByRole('checkbox');
        checkboxes.forEach((cb) => expect(cb).toBeChecked());
    });

    it('does NOT auto-select new games from subsequent deliveries', () => {
        renderPage();
        deliverGames([makeGame('wow', 'World of Warcraft')]);

        // Deselect wow manually
        const wowCheckbox = screen.getByRole('checkbox');
        fireEvent.change(wowCheckbox, { target: { checked: false } });
        expect(wowCheckbox).not.toBeChecked();

        // A new game arrives (e.g. different month)
        deliverGames([makeGame('apex', 'Apex Legends')]);

        // apex is new but should NOT be auto-selected — user curated their filter
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
    });

    afterEach(() => {
        activeQueryClient?.clear();
    });

    it('shows all games inline when count <= maxVisible (5)', () => {
        renderPage();
        deliverGames([
            makeGame('a', 'Alpha'),
            makeGame('b', 'Beta'),
            makeGame('c', 'Gamma'),
            makeGame('d', 'Delta'),
            makeGame('e', 'Epsilon'),
        ]);

        // Exactly 5 checkboxes in inline list
        const checkboxes = screen.getAllByRole('checkbox');
        expect(checkboxes).toHaveLength(5);

        // No overflow button when count equals cap
        expect(screen.queryByText(/Show all/i)).not.toBeInTheDocument();
    });

    it('shows "Show all N games..." button when count > maxVisible', () => {
        renderPage();
        deliverGames([
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
        renderPage();
        deliverGames([
            makeGame('a', 'Alpha'),
            makeGame('b', 'Beta'),
            makeGame('c', 'Gamma'),
            makeGame('d', 'Delta'),
            makeGame('e', 'Epsilon'),
            makeGame('f', 'Foxtrot'),
        ]);

        // Only 5 checkboxes in inline list (6th is in overflow)
        const checkboxes = screen.getAllByRole('checkbox');
        expect(checkboxes).toHaveLength(5);
    });

    it('"Show all" button count reflects total game count including overflow', () => {
        renderPage();
        deliverGames([
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
    });

    afterEach(() => {
        activeQueryClient?.clear();
    });

    function setupWithOverflow() {
        renderPage();
        deliverGames([
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

    it('filter modal is not visible initially (before "Show all" is clicked)', () => {
        setupWithOverflow();
        // The real Modal renders nothing when isOpen=false
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
        // Sorted: Alpha, Beta, Delta, Epsilon, Foxtrot, Gamma
        expect(names[0]).toBe('Alpha');
        expect(names[1]).toBe('Beta');
        expect(names[2]).toBe('Delta');
        expect(names[3]).toBe('Epsilon');
        expect(names[4]).toBe('Foxtrot');
        expect(names[5]).toBe('Gamma');
    });
});

describe('CalendarPage — game toggle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useGameFilterStore.getState()._reset();
    });

    afterEach(() => {
        activeQueryClient?.clear();
    });

    it('unchecking a game deselects it (checkbox becomes unchecked)', () => {
        renderPage();
        deliverGames([makeGame('wow', 'World of Warcraft')]);

        const checkbox = screen.getByRole('checkbox');
        expect(checkbox).toBeChecked();

        fireEvent.change(checkbox, { target: { checked: false } });
        expect(checkbox).not.toBeChecked();
    });

    it('checking an unchecked game re-selects it', () => {
        renderPage();
        deliverGames([makeGame('wow', 'World of Warcraft')]);

        const checkbox = screen.getByRole('checkbox');
        fireEvent.change(checkbox, { target: { checked: false } });
        expect(checkbox).not.toBeChecked();

        fireEvent.change(checkbox, { target: { checked: true } });
        expect(checkbox).toBeChecked();
    });

    it('toggling in modal stays synced with inline list', () => {
        renderPage();
        // 6 games to force overflow (cap=5); sorted: Alpha, Beta, Delta, Epsilon, Foxtrot, Gamma
        deliverGames([
            makeGame('a', 'Alpha'),
            makeGame('b', 'Beta'),
            makeGame('c', 'Gamma'),
            makeGame('d', 'Delta'),
            makeGame('e', 'Epsilon'),
            makeGame('f', 'Foxtrot'),
        ]);

        // Open modal and toggle Alpha off by clicking its label
        fireEvent.click(screen.getByText(/Show all/i));
        const dialog = screen.getByRole('dialog');

        // Find Alpha's label in the modal and click it (triggers onChange → toggleGame)
        const alphaLabel = Array.from(dialog.querySelectorAll('label.game-filter-item')).find(
            (lbl) => lbl.querySelector('.game-filter-name')?.textContent === 'Alpha',
        ) as HTMLElement | undefined;
        expect(alphaLabel).toBeDefined();

        // Verify it's currently selected
        const alphaCheckboxBefore = alphaLabel!.querySelector('input[type="checkbox"]') as HTMLInputElement;
        expect(alphaCheckboxBefore).toBeChecked();

        // Click the label to toggle
        fireEvent.click(alphaLabel!);

        // Verify it's now deselected in the modal
        const alphaCheckboxAfter = alphaLabel!.querySelector('input[type="checkbox"]') as HTMLInputElement;
        expect(alphaCheckboxAfter).not.toBeChecked();

        // Close modal
        fireEvent.click(screen.getByRole('button', { name: 'Close modal' }));

        // Alpha is in the first 5 alphabetically (Alpha, Beta, Delta, Epsilon, Foxtrot), so it's in inline list
        const inlineCheckboxes = screen.getAllByRole('checkbox');
        const inlineAlpha = inlineCheckboxes.find((cb) =>
            (cb.closest('label') as HTMLElement | null)?.querySelector('.game-filter-name')?.textContent === 'Alpha',
        ) as HTMLInputElement | undefined;

        expect(inlineAlpha).toBeDefined();
        expect(inlineAlpha).not.toBeChecked();
    });
});

describe('CalendarPage — All / None buttons', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useGameFilterStore.getState()._reset();
    });

    afterEach(() => {
        activeQueryClient?.clear();
    });

    it('"All" button selects all known games (inline area)', () => {
        renderPage();
        deliverGames([makeGame('a', 'Alpha'), makeGame('b', 'Beta'), makeGame('c', 'Gamma')]);

        // Deselect one first
        const checkboxes = screen.getAllByRole('checkbox');
        fireEvent.change(checkboxes[0], { target: { checked: false } });
        expect(checkboxes[0]).not.toBeChecked();

        // Click the "All" button in the sidebar (not in modal)
        const allBtns = screen.getAllByRole('button', { name: /^All$/i });
        fireEvent.click(allBtns[0]);

        // All inline checkboxes checked again
        screen.getAllByRole('checkbox').forEach((cb) => expect(cb).toBeChecked());
    });

    it('"None" button deselects all games', () => {
        renderPage();
        deliverGames([makeGame('a', 'Alpha'), makeGame('b', 'Beta'), makeGame('c', 'Gamma')]);

        const noneBtns = screen.getAllByRole('button', { name: /^None$/i });
        fireEvent.click(noneBtns[0]);

        screen.getAllByRole('checkbox').forEach((cb) => expect(cb).not.toBeChecked());
    });

    it('"All" in modal selects all games including those not in inline list', () => {
        renderPage();
        deliverGames([
            makeGame('a', 'Alpha'),
            makeGame('b', 'Beta'),
            makeGame('c', 'Gamma'),
            makeGame('d', 'Delta'),
            makeGame('e', 'Epsilon'),
            makeGame('f', 'Foxtrot'),
        ]);

        // Open modal, deselect all via "None", then re-select via "All"
        fireEvent.click(screen.getByText(/Show all/i));
        const dialog = screen.getByRole('dialog');

        const noneBtns = Array.from(dialog.querySelectorAll('button')).filter((b) => b.textContent === 'None');
        fireEvent.click(noneBtns[0]);

        // All modal checkboxes should be unchecked
        const modalCheckboxes = Array.from(dialog.querySelectorAll('input[type="checkbox"]'));
        modalCheckboxes.forEach((cb) => expect(cb as HTMLInputElement).not.toBeChecked());

        // Now click "All" inside the modal
        const allBtns = Array.from(dialog.querySelectorAll('button')).filter((b) => b.textContent === 'All');
        fireEvent.click(allBtns[0]);

        modalCheckboxes.forEach((cb) => expect(cb as HTMLInputElement).toBeChecked());
    });

    it('"None" deselects all games immediately', () => {
        renderPage();
        deliverGames([makeGame('wow', 'World of Warcraft'), makeGame('apex', 'Apex Legends')]);

        // Verify all selected first
        screen.getAllByRole('checkbox').forEach((cb) => expect(cb).toBeChecked());

        const noneBtns = screen.getAllByRole('button', { name: /^None$/i });
        fireEvent.click(noneBtns[0]);

        // All immediately unchecked
        screen.getAllByRole('checkbox').forEach((cb) => expect(cb).not.toBeChecked());
    });
});

describe('CalendarPage — filter persistence when view changes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useGameFilterStore.getState()._reset();
    });

    afterEach(() => {
        activeQueryClient?.clear();
    });

    it('filter selections persist across re-renders with same games (no new games delivered)', () => {
        const { rerender } = renderPage();
        deliverGames([makeGame('wow', 'World of Warcraft'), makeGame('apex', 'Apex Legends')]);

        // Deselect wow via label click
        const checkboxes = screen.getAllByRole('checkbox');
        const wowLabel = checkboxes
            .map((cb) => cb.closest('label') as HTMLElement | null)
            .find((lbl) => lbl?.querySelector('.game-filter-name')?.textContent?.includes('World'));
        expect(wowLabel).toBeTruthy();
        fireEvent.click(wowLabel!);

        // Verify wow is deselected
        const wowCb = wowLabel!.querySelector('input[type="checkbox"]') as HTMLInputElement;
        expect(wowCb).not.toBeChecked();

        // Simulate external prop change (not re-delivering games) — component re-renders
        const rerenderQc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        rerender(
            <QueryClientProvider client={rerenderQc}>
                <MemoryRouter>
                    <CalendarPage />
                </MemoryRouter>
            </QueryClientProvider>,
        );

        // State should be preserved through React re-renders (not caused by games delivery)
        // Find wow checkbox again — it should still be unchecked
        const updatedLabels = screen.getAllByRole('checkbox').map(
            (cb) => cb.closest('label') as HTMLElement | null,
        );
        const updatedWowLabel = updatedLabels.find(
            (lbl) => lbl?.querySelector('.game-filter-name')?.textContent?.includes('World'),
        );
        if (updatedWowLabel) {
            const updatedWowCb = updatedWowLabel.querySelector('input[type="checkbox"]') as HTMLInputElement;
            expect(updatedWowCb).not.toBeChecked();
        }
    });

    it('filter selections survive component unmount/remount (ROK-372 regression)', () => {
        // This is the core bug: when CalendarPage remounts (StrictMode, HMR, Suspense),
        // the old approach using useRef lost hasInitialized and seenSlugs, causing
        // all games to be re-selected. With the Zustand store, state persists.
        const { unmount } = renderPage();
        deliverGames([makeGame('wow', 'World of Warcraft'), makeGame('apex', 'Apex Legends')]);

        // Deselect wow
        const wowLabel = screen.getAllByRole('checkbox')
            .map((cb) => cb.closest('label') as HTMLElement | null)
            .find((lbl) => lbl?.querySelector('.game-filter-name')?.textContent?.includes('World'));
        expect(wowLabel).toBeTruthy();
        fireEvent.click(wowLabel!);

        const wowCb = wowLabel!.querySelector('input[type="checkbox"]') as HTMLInputElement;
        expect(wowCb).not.toBeChecked();

        // Unmount the component (simulates what happens on remount)
        unmount();

        // Re-render a fresh CalendarPage — old ref-based state would be gone,
        // but Zustand store retains hasInitialized, seenSlugs, and selectedGames
        renderPage();

        // Re-deliver the same games (as CalendarView would on mount)
        deliverGames([makeGame('wow', 'World of Warcraft'), makeGame('apex', 'Apex Legends')]);

        // wow must STILL be deselected (store remembers the user's toggle)
        const updatedCheckboxes = screen.getAllByRole('checkbox');
        const updatedWowLabel = updatedCheckboxes
            .map((cb) => cb.closest('label') as HTMLElement | null)
            .find((lbl) => lbl?.querySelector('.game-filter-name')?.textContent?.includes('World'));
        expect(updatedWowLabel).toBeTruthy();
        const updatedWowCb = updatedWowLabel!.querySelector('input[type="checkbox"]') as HTMLInputElement;
        expect(updatedWowCb).not.toBeChecked();

        // apex must still be selected
        const updatedApexLabel = updatedCheckboxes
            .map((cb) => cb.closest('label') as HTMLElement | null)
            .find((lbl) => lbl?.querySelector('.game-filter-name')?.textContent?.includes('Apex'));
        expect(updatedApexLabel).toBeTruthy();
        const updatedApexCb = updatedApexLabel!.querySelector('input[type="checkbox"]') as HTMLInputElement;
        expect(updatedApexCb).toBeChecked();
    });

    it('filter selections persist when same games are re-reported (month change scenario)', () => {
        renderPage();
        // Initial delivery
        deliverGames([makeGame('wow', 'World of Warcraft'), makeGame('apex', 'Apex Legends')]);

        // Deselect wow
        const wowLabel = screen.getAllByRole('checkbox')
            .map((cb) => cb.closest('label') as HTMLElement | null)
            .find((lbl) => lbl?.querySelector('.game-filter-name')?.textContent?.includes('World'));
        fireEvent.click(wowLabel!);

        // Simulate month change: empty delivery (loading), then same games
        deliverGames([]);
        deliverGames([makeGame('wow', 'World of Warcraft'), makeGame('apex', 'Apex Legends')]);

        // wow must still be deselected
        const updatedWowCb = wowLabel!.querySelector('input[type="checkbox"]') as HTMLInputElement;
        expect(updatedWowCb).not.toBeChecked();
    });

    it('games do not get removed from allKnownGames when a different date range is loaded', () => {
        renderPage();
        // Month A games
        deliverGames([makeGame('wow', 'World of Warcraft')]);
        // Month B different games
        deliverGames([makeGame('apex', 'Apex Legends')]);

        // Both should still be present inline (cap=3, only 2 games total)
        const names = screen.getAllByRole('checkbox').map(
            (cb) => (cb.closest('label') as HTMLElement | null)?.querySelector('.game-filter-name')?.textContent ?? '',
        );
        expect(names).toContain('Apex Legends');
        expect(names).toContain('World of Warcraft');
    });
});

describe('CalendarPage — FAB and BottomSheet', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useGameFilterStore.getState()._reset();
    });

    afterEach(() => {
        activeQueryClient?.clear();
    });

    it('FAB is not visible before any games arrive', () => {
        renderPage();
        expect(screen.queryByTestId('fab')).not.toBeInTheDocument();
    });

    it('FAB appears after games arrive', () => {
        renderPage();
        deliverGames([makeGame('wow', 'World of Warcraft')]);
        expect(screen.getByTestId('fab')).toBeInTheDocument();
    });

    it('clicking FAB opens bottom sheet', () => {
        renderPage();
        deliverGames([makeGame('wow', 'World of Warcraft')]);

        const fab = screen.getByTestId('fab');
        fireEvent.click(fab);

        const sheet = screen.getByTestId('bottom-sheet');
        expect(sheet).toHaveAttribute('data-open', 'true');
    });

    it('bottom sheet is initially closed', () => {
        renderPage();
        deliverGames([makeGame('wow', 'World of Warcraft')]);

        const sheet = screen.getByTestId('bottom-sheet');
        expect(sheet).toHaveAttribute('data-open', 'false');
    });

    it('bottom sheet contains all games including overflow', () => {
        renderPage();
        deliverGames([
            makeGame('a', 'Alpha'),
            makeGame('b', 'Beta'),
            makeGame('c', 'Gamma'),
            makeGame('d', 'Delta'),
            makeGame('e', 'Epsilon'),
            makeGame('f', 'Foxtrot'),
        ]);

        const sheet = screen.getByTestId('bottom-sheet');
        expect(sheet).toHaveTextContent('Alpha');
        expect(sheet).toHaveTextContent('Beta');
        expect(sheet).toHaveTextContent('Gamma');
        expect(sheet).toHaveTextContent('Delta');
        expect(sheet).toHaveTextContent('Epsilon');
        expect(sheet).toHaveTextContent('Foxtrot');
    });

    it('bottom sheet shows count of selected vs total games', () => {
        renderPage();
        deliverGames([makeGame('a', 'Alpha'), makeGame('b', 'Beta'), makeGame('c', 'Gamma')]);

        const sheet = screen.getByTestId('bottom-sheet');
        // "3 of 3 selected" pattern
        expect(sheet).toHaveTextContent(/3 of 3 selected/i);
    });
});

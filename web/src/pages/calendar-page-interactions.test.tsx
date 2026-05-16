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

/** Click the desktop [Filter: …] chip to open the modal.
 * The mobile FAB also has aria-label "Filter by Game"; disambiguate via class. */
function getChip(): HTMLElement {
    const chip = document.querySelector('.calendar-filter-chip') as HTMLElement | null;
    if (!chip) throw new Error('CalendarFilterChip not rendered');
    return chip;
}

function openModalViaChip() {
    fireEvent.click(getChip());
}

/** Return the currently-open modal dialog. */
function getDialog() {
    return screen.getByRole('dialog');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CalendarPage — game toggle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useGameFilterStore.getState()._reset();
        mockRegistryGames = [];
    });

    afterEach(() => {
        activeQueryClient?.clear();
    });

    it('unchecking a game in the modal deselects it', () => {
        render_page();
        deliver([makeGame('wow', 'World of Warcraft')]);

        openModalViaChip();
        const checkbox = within(getDialog()).getByRole('checkbox');
        expect(checkbox).toBeChecked();

        fireEvent.change(checkbox, { target: { checked: false } });
        expect(checkbox).not.toBeChecked();
    });

    it('checking an unchecked game re-selects it', () => {
        render_page();
        deliver([makeGame('wow', 'World of Warcraft')]);

        openModalViaChip();
        const checkbox = within(getDialog()).getByRole('checkbox');
        fireEvent.change(checkbox, { target: { checked: false } });
        expect(checkbox).not.toBeChecked();

        fireEvent.change(checkbox, { target: { checked: true } });
        expect(checkbox).toBeChecked();
    });

    it('toggling in modal updates chip label', () => {
        render_page();
        deliver([
            makeGame('a', 'Alpha'),
            makeGame('b', 'Beta'),
            makeGame('c', 'Gamma'),
            makeGame('d', 'Delta'),
            makeGame('e', 'Epsilon'),
            makeGame('f', 'Foxtrot'),
        ]);

        openModalViaChip();
        const dialog = getDialog();

        const alphaLabel = Array.from(dialog.querySelectorAll('label.game-filter-item')).find(
            (lbl) => lbl.querySelector('.game-filter-name')?.textContent === 'Alpha',
        ) as HTMLElement | undefined;
        expect(alphaLabel).toBeDefined();

        const alphaCheckboxBefore = alphaLabel!.querySelector('input[type="checkbox"]') as HTMLInputElement;
        expect(alphaCheckboxBefore).toBeChecked();

        fireEvent.click(alphaLabel!);

        const alphaCheckboxAfter = alphaLabel!.querySelector('input[type="checkbox"]') as HTMLInputElement;
        expect(alphaCheckboxAfter).not.toBeChecked();

        fireEvent.click(screen.getByRole('button', { name: 'Close modal' }));

        // The chip now reflects the partial selection (5 of 6).
        expect(getChip()).toHaveTextContent(/Filter: 5 games/);
    });
});

describe('CalendarPage — All / None buttons', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useGameFilterStore.getState()._reset();
        mockRegistryGames = [];
    });

    afterEach(() => {
        activeQueryClient?.clear();
    });

    it('"All" button in modal selects all known games', () => {
        render_page();
        deliver([makeGame('a', 'Alpha'), makeGame('b', 'Beta'), makeGame('c', 'Gamma')]);

        openModalViaChip();
        const dialog = getDialog();

        const checkboxes = within(dialog).getAllByRole('checkbox');
        fireEvent.change(checkboxes[0], { target: { checked: false } });
        expect(checkboxes[0]).not.toBeChecked();

        const allBtn = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'All')!;
        fireEvent.click(allBtn);

        within(dialog).getAllByRole('checkbox').forEach((cb) => expect(cb).toBeChecked());
    });

    it('"None" button in modal deselects all games', () => {
        render_page();
        deliver([makeGame('a', 'Alpha'), makeGame('b', 'Beta'), makeGame('c', 'Gamma')]);

        openModalViaChip();
        const dialog = getDialog();

        const noneBtn = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'None')!;
        fireEvent.click(noneBtn);

        within(dialog).getAllByRole('checkbox').forEach((cb) => expect(cb).not.toBeChecked());
    });

    it('"All" in modal selects all games including those scrolled off the inline list', () => {
        render_page();
        deliver([
            makeGame('a', 'Alpha'),
            makeGame('b', 'Beta'),
            makeGame('c', 'Gamma'),
            makeGame('d', 'Delta'),
            makeGame('e', 'Epsilon'),
            makeGame('f', 'Foxtrot'),
        ]);

        openModalViaChip();
        const dialog = getDialog();

        const noneBtns = Array.from(dialog.querySelectorAll('button')).filter((b) => b.textContent === 'None');
        fireEvent.click(noneBtns[0]);

        const modalCheckboxes = Array.from(dialog.querySelectorAll('input[type="checkbox"]'));
        modalCheckboxes.forEach((cb) => expect(cb as HTMLInputElement).not.toBeChecked());

        const allBtns = Array.from(dialog.querySelectorAll('button')).filter((b) => b.textContent === 'All');
        fireEvent.click(allBtns[0]);

        modalCheckboxes.forEach((cb) => expect(cb as HTMLInputElement).toBeChecked());
    });
});

describe('CalendarPage — filter persistence when view changes — part 1', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useGameFilterStore.getState()._reset();
        mockRegistryGames = [];
    });
    afterEach(() => {
        activeQueryClient?.clear();
    });

    it('filter selections persist across re-renders with same games', () => {
        const { rerender } = render_page();
        deliver([makeGame('wow', 'World of Warcraft'), makeGame('apex', 'Apex Legends')]);

        openModalViaChip();
        const dialog = getDialog();

        const wowLabel = Array.from(dialog.querySelectorAll('label.game-filter-item')).find(
            (lbl) => lbl.querySelector('.game-filter-name')?.textContent?.includes('World'),
        ) as HTMLElement | undefined;
        expect(wowLabel).toBeTruthy();
        fireEvent.click(wowLabel!);

        const wowCb = wowLabel!.querySelector('input[type="checkbox"]') as HTMLInputElement;
        expect(wowCb).not.toBeChecked();

        // Close modal before rerender so the modal-open state doesn't carry through.
        fireEvent.click(screen.getByRole('button', { name: 'Close modal' }));

        const rerenderQc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        rerender(
            <QueryClientProvider client={rerenderQc}>
                <MemoryRouter>
                    <CalendarPage />
                </MemoryRouter>
            </QueryClientProvider>,
        );

        // The store retained the deselection — verify by opening the modal again.
        openModalViaChip();
        const newDialog = getDialog();
        const updatedWowLabel = Array.from(newDialog.querySelectorAll('label.game-filter-item')).find(
            (lbl) => lbl.querySelector('.game-filter-name')?.textContent?.includes('World'),
        ) as HTMLElement | undefined;
        if (updatedWowLabel) {
            const updatedWowCb = updatedWowLabel.querySelector('input[type="checkbox"]') as HTMLInputElement;
            expect(updatedWowCb).not.toBeChecked();
        }
    });
});

describe('CalendarPage — filter persistence when view changes — part 2', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useGameFilterStore.getState()._reset();
        mockRegistryGames = [];
    });
    afterEach(() => {
        activeQueryClient?.clear();
    });

    it('filter selections survive component unmount/remount (ROK-372 regression)', () => {
        const { unmount } = render_page();
        deliver([makeGame('wow', 'World of Warcraft'), makeGame('apex', 'Apex Legends')]);

        openModalViaChip();
        const wowLabel = Array.from(getDialog().querySelectorAll('label.game-filter-item')).find(
            (lbl) => lbl.querySelector('.game-filter-name')?.textContent?.includes('World'),
        ) as HTMLElement | undefined;
        expect(wowLabel).toBeTruthy();
        fireEvent.click(wowLabel!);

        const wowCb = wowLabel!.querySelector('input[type="checkbox"]') as HTMLInputElement;
        expect(wowCb).not.toBeChecked();

        unmount();
        render_page();
        deliver([makeGame('wow', 'World of Warcraft'), makeGame('apex', 'Apex Legends')]);

        openModalViaChip();
        const newDialog = getDialog();
        const updatedWowLabel = Array.from(newDialog.querySelectorAll('label.game-filter-item')).find(
            (lbl) => lbl.querySelector('.game-filter-name')?.textContent?.includes('World'),
        ) as HTMLElement | undefined;
        expect(updatedWowLabel).toBeTruthy();
        const updatedWowCb = updatedWowLabel!.querySelector('input[type="checkbox"]') as HTMLInputElement;
        expect(updatedWowCb).not.toBeChecked();

        const updatedApexLabel = Array.from(newDialog.querySelectorAll('label.game-filter-item')).find(
            (lbl) => lbl.querySelector('.game-filter-name')?.textContent?.includes('Apex'),
        ) as HTMLElement | undefined;
        expect(updatedApexLabel).toBeTruthy();
        const updatedApexCb = updatedApexLabel!.querySelector('input[type="checkbox"]') as HTMLInputElement;
        expect(updatedApexCb).toBeChecked();
    });

    it('filter selections persist when same games are re-reported (month change scenario)', () => {
        render_page();
        deliver([makeGame('wow', 'World of Warcraft'), makeGame('apex', 'Apex Legends')]);

        openModalViaChip();
        const wowLabel = Array.from(getDialog().querySelectorAll('label.game-filter-item')).find(
            (lbl) => lbl.querySelector('.game-filter-name')?.textContent?.includes('World'),
        ) as HTMLElement | undefined;
        fireEvent.click(wowLabel!);

        deliver([]);
        deliver([makeGame('wow', 'World of Warcraft'), makeGame('apex', 'Apex Legends')]);

        // Modal is still open and re-renders with same data.
        const updatedWowLabel = Array.from(getDialog().querySelectorAll('label.game-filter-item')).find(
            (lbl) => lbl.querySelector('.game-filter-name')?.textContent?.includes('World'),
        ) as HTMLElement | undefined;
        const updatedWowCb = updatedWowLabel!.querySelector('input[type="checkbox"]') as HTMLInputElement;
        expect(updatedWowCb).not.toBeChecked();
    });
});

describe('CalendarPage — filter persistence when view changes — part 3', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useGameFilterStore.getState()._reset();
        mockRegistryGames = [];
    });
    afterEach(() => {
        activeQueryClient?.clear();
    });

    it('games do not get removed from allKnownGames when a different date range is loaded', () => {
        render_page();
        deliver([makeGame('wow', 'World of Warcraft')]);
        deliver([makeGame('apex', 'Apex Legends')]);

        openModalViaChip();
        const dialog = getDialog();
        const names = within(dialog).getAllByRole('checkbox').map(
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
        mockRegistryGames = [];
    });

    afterEach(() => {
        activeQueryClient?.clear();
    });

    it('FAB is not visible before any games arrive', () => {
        render_page();
        expect(screen.queryByTestId('fab')).not.toBeInTheDocument();
    });

    it('FAB appears after games arrive', () => {
        mockRegistryGames = [makeRegistryGame('wow', 'World of Warcraft')];
        render_page();
        expect(screen.getByTestId('fab')).toBeInTheDocument();
    });

    it('clicking FAB opens bottom sheet', () => {
        mockRegistryGames = [makeRegistryGame('wow', 'World of Warcraft')];
        render_page();

        const fab = screen.getByTestId('fab');
        fireEvent.click(fab);

        const sheet = screen.getByTestId('bottom-sheet');
        expect(sheet).toHaveAttribute('data-open', 'true');
    });

    it('bottom sheet is initially closed', () => {
        mockRegistryGames = [makeRegistryGame('wow', 'World of Warcraft')];
        render_page();

        const sheet = screen.getByTestId('bottom-sheet');
        expect(sheet).toHaveAttribute('data-open', 'false');
    });

    it('bottom sheet contains all games', () => {
        render_page();
        deliver([
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
        render_page();
        deliver([makeGame('a', 'Alpha'), makeGame('b', 'Beta'), makeGame('c', 'Gamma')]);

        const sheet = screen.getByTestId('bottom-sheet');
        expect(sheet).toHaveTextContent(/3 of 3 selected/i);
    });
});

describe('CalendarPage — useGameRegistry integration (ROK-650)', () => {
    beforeEach(() => {
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

        openModalViaChip();
        const dialog = getDialog();
        const gameNames = within(dialog).getAllByRole('checkbox').map(
            (cb) => (cb.closest('label') as HTMLElement | null)?.querySelector('.game-filter-name')?.textContent ?? '',
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

        openModalViaChip();
        const dialog = getDialog();
        const checkboxes = within(dialog).getAllByRole('checkbox');
        expect(checkboxes).toHaveLength(3);
        checkboxes.forEach((cb) => expect(cb).toBeChecked());
    });
});

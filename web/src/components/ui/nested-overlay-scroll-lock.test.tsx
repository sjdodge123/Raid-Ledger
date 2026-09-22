/**
 * ROK-1640: "Discard your changes?" is a `Modal` stacked over an open
 * `BottomSheet`. Closing the confirm ("Keep editing") must NOT release the
 * page's body scroll lock while the sheet is still open; closing the sheet
 * must. Both primitives share the ref-counted `useBodyScrollLock`.
 */
import { useState } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BottomSheet } from './bottom-sheet';
import { Modal } from './modal';
import { MoreDrawer } from '../layout/more-drawer';

vi.mock('../../hooks/use-auth', () => ({
    useAuth: () => ({
        user: { id: 1, discordId: '1', username: 'TestUser', displayName: 'Test User', avatar: null, customAvatarUrl: null, role: 'member' },
        isAuthenticated: true, isImpersonating: false, logout: vi.fn(),
    }),
    isAdmin: () => false,
    isOperatorOrAdmin: () => false,
    getAuthToken: () => 'mock-token',
}));
vi.mock('../../stores/theme-store', () => ({
    useThemeStore: (selector: (s: Record<string, unknown>) => unknown) => selector({ themeMode: 'dark', cycleTheme: vi.fn() }),
}));
vi.mock('../../hooks/use-onboarding-fte', () => ({ useResetOnboarding: () => ({ mutate: vi.fn(), isPending: false }) }));
vi.mock('../../hooks/use-game-time', () => ({
    useGameTime: () => ({ data: { slots: [], gameTimeAgeDays: null } }),
    useGameTimeAbsences: () => ({ data: [] }),
    useConfirmGameTime: () => ({ mutate: vi.fn(), isPending: false }),
    useSaveGameTime: () => ({ mutate: vi.fn(), isPending: false }),
    useCreateAbsence: () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false }),
    useDeleteAbsence: () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false }),
}));

/** The More drawer, with its open state owned here so it can close while the game-time sheet stays open. */
function renderMoreDrawer() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (isOpen: boolean) => (
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={['/profile/identity']}>
                <MoreDrawer isOpen={isOpen} onClose={() => {}} />
            </MemoryRouter>
        </QueryClientProvider>
    );
    const view = render(tree(true));
    return { closeMore: () => view.rerender(tree(false)) };
}

function SheetWithConfirm({ onSheetClosed }: { onSheetClosed?: () => void }) {
    const [sheetOpen, setSheetOpen] = useState(true);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const closeSheet = () => { setSheetOpen(false); onSheetClosed?.(); };
    return (
        <BottomSheet isOpen={sheetOpen} onClose={closeSheet} ariaLabel="Editor sheet">
            <button type="button" onClick={() => setConfirmOpen(true)}>Ask to discard</button>
            <button type="button" onClick={closeSheet}>Close sheet</button>
            <Modal isOpen={confirmOpen} onClose={() => setConfirmOpen(false)} title="Discard your changes?">
                <button type="button" onClick={() => setConfirmOpen(false)}>Keep editing</button>
            </Modal>
        </BottomSheet>
    );
}

describe('nested overlays share one body scroll lock', () => {
    afterEach(() => { document.body.style.overflow = ''; });

    it('closing a Modal over an open BottomSheet keeps the body locked; closing the sheet unlocks it', () => {
        render(<SheetWithConfirm />);
        expect(document.body.style.overflow).toBe('hidden');

        fireEvent.click(screen.getByRole('button', { name: 'Ask to discard' }));
        expect(screen.getByRole('heading', { name: 'Discard your changes?' })).toBeInTheDocument();
        expect(document.body.style.overflow).toBe('hidden');

        fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
        expect(screen.queryByRole('heading', { name: 'Discard your changes?' })).not.toBeInTheDocument();
        expect(document.body.style.overflow, 'sheet still open, so the body must stay locked').toBe('hidden');

        fireEvent.click(screen.getByRole('button', { name: 'Close sheet' }));
        expect(document.body.style.overflow, 'last overlay closed, so the body must unlock').toBe('');
    });

    it('unmounting the whole stack releases every lock', () => {
        const { unmount } = render(<SheetWithConfirm />);
        fireEvent.click(screen.getByRole('button', { name: 'Ask to discard' }));
        unmount();
        expect(document.body.style.overflow).toBe('');
    });

    it('the More drawer closing under an open game-time sheet keeps the body locked; closing the sheet unlocks it', () => {
        const { closeMore } = renderMoreDrawer();
        expect(document.body.style.overflow).toBe('hidden');

        fireEvent.click(screen.getByTestId('more-drawer-game-time'));
        expect(screen.getByTestId('game-time-check-sheet')).toBeInTheDocument();

        closeMore();
        expect(document.body.style.overflow, 'game-time sheet still open, so the body must stay locked').toBe('hidden');

        fireEvent.click(screen.getByRole('button', { name: 'Close sheet' }));
        expect(screen.queryByTestId('game-time-check-sheet')).not.toBeInTheDocument();
        expect(document.body.style.overflow, 'last overlay closed, so the body must unlock').toBe('');
    });
});

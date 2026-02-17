import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GameLibraryTable } from './GameLibraryTable';

// ============================================================
// Module mocks
// ============================================================

vi.mock('../../hooks/use-admin-games', () => ({
    useAdminGames: vi.fn(),
}));

vi.mock('../../lib/toast', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
    },
}));

import { useAdminGames } from '../../hooks/use-admin-games';
import { toast } from '../../lib/toast';

// ============================================================
// Helpers
// ============================================================

const makeGame = (overrides: Partial<{
    id: number;
    igdbId: number;
    name: string;
    slug: string;
    coverUrl: string | null;
    cachedAt: string;
    hidden: boolean;
}> = {}) => ({
    id: 1,
    igdbId: 1001,
    name: 'Valheim',
    slug: 'valheim',
    coverUrl: null,
    cachedAt: new Date().toISOString(),
    hidden: false,
    ...overrides,
});

const makeResponse = (games: ReturnType<typeof makeGame>[], total = games.length, page = 1, totalPages = 1) => ({
    data: games,
    meta: { total, page, limit: 20, totalPages },
});

const makeMockHook = (overrides: Partial<ReturnType<typeof useAdminGames>> = {}) => ({
    games: {
        data: makeResponse([]),
        isLoading: false,
        isError: false,
    },
    deleteGame: {
        mutateAsync: vi.fn().mockResolvedValue({ success: true, message: 'Deleted' }),
        isPending: false,
    },
    hideGame: {
        mutateAsync: vi.fn().mockResolvedValue({ success: true, message: 'Hidden' }),
        isPending: false,
    },
    unhideGame: {
        mutateAsync: vi.fn().mockResolvedValue({ success: true, message: 'Visible' }),
        isPending: false,
    },
    ...overrides,
});

// ============================================================
// Tests
// ============================================================

describe('GameLibraryTable', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useAdminGames).mockReturnValue(makeMockHook() as ReturnType<typeof useAdminGames>);
    });

    // ---- Rendering ----

    it('renders the section header', () => {
        render(<GameLibraryTable />);
        expect(screen.getByText('Manage Library')).toBeInTheDocument();
    });

    it('shows loading state when games are loading', () => {
        vi.mocked(useAdminGames).mockReturnValue(makeMockHook({
            games: { data: undefined, isLoading: true, isError: false } as any,
        }) as ReturnType<typeof useAdminGames>);

        render(<GameLibraryTable />);
        expect(screen.getByText(/Loading games/i)).toBeInTheDocument();
    });

    it('shows empty state with default message when no games', () => {
        render(<GameLibraryTable />);
        expect(screen.getByText(/No games in library yet/i)).toBeInTheDocument();
    });

    it('shows search-specific empty state when search is active', async () => {
        render(<GameLibraryTable />);

        const searchInput = screen.getByPlaceholderText(/search games/i);
        fireEvent.change(searchInput, { target: { value: 'nonexistent' } });

        // Wait for debounce + re-render after search
        await waitFor(() => {
            expect(screen.getByText(/No games match your search/i)).toBeInTheDocument();
        }, { timeout: 500 });
    });

    it('shows "No hidden games" when showHidden=only and no results', async () => {
        render(<GameLibraryTable />);

        const checkbox = screen.getByRole('checkbox');
        fireEvent.click(checkbox);

        await waitFor(() => {
            expect(screen.getByText(/No hidden games/i)).toBeInTheDocument();
        });
    });

    it('renders game rows when data is present', () => {
        vi.mocked(useAdminGames).mockReturnValue(makeMockHook({
            games: {
                data: makeResponse([makeGame({ name: 'Valheim', id: 1 })]),
                isLoading: false,
                isError: false,
            } as any,
        }) as ReturnType<typeof useAdminGames>);

        render(<GameLibraryTable />);
        expect(screen.getByText('Valheim')).toBeInTheDocument();
    });

    // ---- Hidden badge ----

    it('shows "Hidden" badge for hidden games', () => {
        vi.mocked(useAdminGames).mockReturnValue(makeMockHook({
            games: {
                data: makeResponse([makeGame({ hidden: true, name: 'Banned Game' })]),
                isLoading: false,
                isError: false,
            } as any,
        }) as ReturnType<typeof useAdminGames>);

        render(<GameLibraryTable />);
        expect(screen.getByText('Hidden')).toBeInTheDocument();
    });

    it('does NOT show "Hidden" badge for visible games', () => {
        vi.mocked(useAdminGames).mockReturnValue(makeMockHook({
            games: {
                data: makeResponse([makeGame({ hidden: false, name: 'Visible Game' })]),
                isLoading: false,
                isError: false,
            } as any,
        }) as ReturnType<typeof useAdminGames>);

        render(<GameLibraryTable />);
        expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
    });

    // ---- Hide/Unhide buttons ----

    it('shows hide button (eye-off icon) for visible games', () => {
        vi.mocked(useAdminGames).mockReturnValue(makeMockHook({
            games: {
                data: makeResponse([makeGame({ hidden: false })]),
                isLoading: false,
                isError: false,
            } as any,
        }) as ReturnType<typeof useAdminGames>);

        render(<GameLibraryTable />);
        expect(screen.getByTitle('Hide game from users')).toBeInTheDocument();
        expect(screen.queryByTitle('Unhide game')).not.toBeInTheDocument();
    });

    it('shows unhide button (eye icon) for hidden games', () => {
        vi.mocked(useAdminGames).mockReturnValue(makeMockHook({
            games: {
                data: makeResponse([makeGame({ hidden: true })]),
                isLoading: false,
                isError: false,
            } as any,
        }) as ReturnType<typeof useAdminGames>);

        render(<GameLibraryTable />);
        expect(screen.getByTitle('Unhide game')).toBeInTheDocument();
        expect(screen.queryByTitle('Hide game from users')).not.toBeInTheDocument();
    });

    it('calls hideGame.mutateAsync with the correct game id', async () => {
        const hideGame = { mutateAsync: vi.fn().mockResolvedValue({ success: true, message: 'Hidden' }), isPending: false };

        vi.mocked(useAdminGames).mockReturnValue(makeMockHook({
            games: {
                data: makeResponse([makeGame({ id: 42, hidden: false })]),
                isLoading: false,
                isError: false,
            } as any,
            hideGame: hideGame as any,
        }) as ReturnType<typeof useAdminGames>);

        render(<GameLibraryTable />);
        fireEvent.click(screen.getByTitle('Hide game from users'));

        await waitFor(() => {
            expect(hideGame.mutateAsync).toHaveBeenCalledWith(42);
        });
    });

    it('calls unhideGame.mutateAsync with the correct game id', async () => {
        const unhideGame = { mutateAsync: vi.fn().mockResolvedValue({ success: true, message: 'Visible' }), isPending: false };

        vi.mocked(useAdminGames).mockReturnValue(makeMockHook({
            games: {
                data: makeResponse([makeGame({ id: 99, hidden: true })]),
                isLoading: false,
                isError: false,
            } as any,
            unhideGame: unhideGame as any,
        }) as ReturnType<typeof useAdminGames>);

        render(<GameLibraryTable />);
        fireEvent.click(screen.getByTitle('Unhide game'));

        await waitFor(() => {
            expect(unhideGame.mutateAsync).toHaveBeenCalledWith(99);
        });
    });

    it('shows success toast after successfully hiding a game', async () => {
        const hideGame = { mutateAsync: vi.fn().mockResolvedValue({ success: true, message: 'Game "Valheim" hidden from users.' }), isPending: false };

        vi.mocked(useAdminGames).mockReturnValue(makeMockHook({
            games: {
                data: makeResponse([makeGame({ hidden: false })]),
                isLoading: false,
                isError: false,
            } as any,
            hideGame: hideGame as any,
        }) as ReturnType<typeof useAdminGames>);

        render(<GameLibraryTable />);
        fireEvent.click(screen.getByTitle('Hide game from users'));

        await waitFor(() => {
            expect(toast.success).toHaveBeenCalledWith('Game "Valheim" hidden from users.');
        });
    });

    it('shows success toast after successfully unhiding a game', async () => {
        const unhideGame = { mutateAsync: vi.fn().mockResolvedValue({ success: true, message: 'Game "Valheim" is now visible to users.' }), isPending: false };

        vi.mocked(useAdminGames).mockReturnValue(makeMockHook({
            games: {
                data: makeResponse([makeGame({ hidden: true })]),
                isLoading: false,
                isError: false,
            } as any,
            unhideGame: unhideGame as any,
        }) as ReturnType<typeof useAdminGames>);

        render(<GameLibraryTable />);
        fireEvent.click(screen.getByTitle('Unhide game'));

        await waitFor(() => {
            expect(toast.success).toHaveBeenCalledWith('Game "Valheim" is now visible to users.');
        });
    });

    it('shows error toast when hide fails', async () => {
        const hideGame = { mutateAsync: vi.fn().mockRejectedValue(new Error('Failed to hide game')), isPending: false };

        vi.mocked(useAdminGames).mockReturnValue(makeMockHook({
            games: {
                data: makeResponse([makeGame({ hidden: false })]),
                isLoading: false,
                isError: false,
            } as any,
            hideGame: hideGame as any,
        }) as ReturnType<typeof useAdminGames>);

        render(<GameLibraryTable />);
        fireEvent.click(screen.getByTitle('Hide game from users'));

        await waitFor(() => {
            expect(toast.error).toHaveBeenCalledWith('Failed to hide game');
        });
    });

    it('shows error toast when unhide fails', async () => {
        const unhideGame = { mutateAsync: vi.fn().mockRejectedValue(new Error('Failed to unhide game')), isPending: false };

        vi.mocked(useAdminGames).mockReturnValue(makeMockHook({
            games: {
                data: makeResponse([makeGame({ hidden: true })]),
                isLoading: false,
                isError: false,
            } as any,
            unhideGame: unhideGame as any,
        }) as ReturnType<typeof useAdminGames>);

        render(<GameLibraryTable />);
        fireEvent.click(screen.getByTitle('Unhide game'));

        await waitFor(() => {
            expect(toast.error).toHaveBeenCalledWith('Failed to unhide game');
        });
    });

    // ---- Show hidden checkbox ----

    it('renders "Show hidden" checkbox', () => {
        render(<GameLibraryTable />);
        expect(screen.getByLabelText(/show hidden/i) ?? screen.getByRole('checkbox')).toBeInTheDocument();
    });

    it('checkbox is unchecked by default', () => {
        render(<GameLibraryTable />);
        const checkbox = screen.getByRole('checkbox');
        expect(checkbox).not.toBeChecked();
    });

    it('passes showHidden="only" to useAdminGames when checkbox is checked', async () => {
        render(<GameLibraryTable />);

        const checkbox = screen.getByRole('checkbox');
        fireEvent.click(checkbox);

        await waitFor(() => {
            const calls = vi.mocked(useAdminGames).mock.calls;
            const lastCall = calls[calls.length - 1];
            expect(lastCall[3]).toBe('only');
        });
    });

    it('passes showHidden=undefined to useAdminGames when checkbox is unchecked', async () => {
        render(<GameLibraryTable />);

        const checkbox = screen.getByRole('checkbox');
        // Click to check then uncheck
        fireEvent.click(checkbox);
        fireEvent.click(checkbox);

        await waitFor(() => {
            const calls = vi.mocked(useAdminGames).mock.calls;
            const lastCall = calls[calls.length - 1];
            expect(lastCall[3]).toBeUndefined();
        });
    });

    // ---- Delete button ----

    it('shows delete button for each game row', () => {
        vi.mocked(useAdminGames).mockReturnValue(makeMockHook({
            games: {
                data: makeResponse([makeGame({ id: 1 })]),
                isLoading: false,
                isError: false,
            } as any,
        }) as ReturnType<typeof useAdminGames>);

        render(<GameLibraryTable />);
        expect(screen.getByTitle('Remove game')).toBeInTheDocument();
    });

    // ---- Disabled state ----

    it('disables hide button when hideGame is pending', () => {
        vi.mocked(useAdminGames).mockReturnValue(makeMockHook({
            games: {
                data: makeResponse([makeGame({ hidden: false })]),
                isLoading: false,
                isError: false,
            } as any,
            hideGame: { mutateAsync: vi.fn(), isPending: true } as any,
        }) as ReturnType<typeof useAdminGames>);

        render(<GameLibraryTable />);
        expect(screen.getByTitle('Hide game from users')).toBeDisabled();
    });

    it('disables unhide button when unhideGame is pending', () => {
        vi.mocked(useAdminGames).mockReturnValue(makeMockHook({
            games: {
                data: makeResponse([makeGame({ hidden: true })]),
                isLoading: false,
                isError: false,
            } as any,
            unhideGame: { mutateAsync: vi.fn(), isPending: true } as any,
        }) as ReturnType<typeof useAdminGames>);

        render(<GameLibraryTable />);
        expect(screen.getByTitle('Unhide game')).toBeDisabled();
    });

    // ---- Pagination ----

    it('does not show pagination when only one page', () => {
        vi.mocked(useAdminGames).mockReturnValue(makeMockHook({
            games: {
                data: makeResponse([makeGame()], 1, 1, 1),
                isLoading: false,
                isError: false,
            } as any,
        }) as ReturnType<typeof useAdminGames>);

        render(<GameLibraryTable />);
        expect(screen.queryByRole('button', { name: /Previous/i })).not.toBeInTheDocument();
    });

    it('shows pagination when multiple pages', () => {
        vi.mocked(useAdminGames).mockReturnValue(makeMockHook({
            games: {
                data: makeResponse(
                    Array.from({ length: 20 }, (_, i) => makeGame({ id: i + 1, name: `Game ${i + 1}` })),
                    100,
                    1,
                    5,
                ),
                isLoading: false,
                isError: false,
            } as any,
        }) as ReturnType<typeof useAdminGames>);

        render(<GameLibraryTable />);
        expect(screen.getByRole('button', { name: /Previous/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Next/i })).toBeInTheDocument();
    });

    it('renders cover image when coverUrl is set', () => {
        vi.mocked(useAdminGames).mockReturnValue(makeMockHook({
            games: {
                data: makeResponse([makeGame({ coverUrl: 'https://example.com/cover.jpg' })]),
                isLoading: false,
                isError: false,
            } as any,
        }) as ReturnType<typeof useAdminGames>);

        const { container } = render(<GameLibraryTable />);
        const img = container.querySelector('img');
        expect(img).toBeInTheDocument();
        expect(img?.getAttribute('src')).toBe('https://example.com/cover.jpg');
    });

    it('renders placeholder div when coverUrl is null', () => {
        vi.mocked(useAdminGames).mockReturnValue(makeMockHook({
            games: {
                data: makeResponse([makeGame({ coverUrl: null })]),
                isLoading: false,
                isError: false,
            } as any,
        }) as ReturnType<typeof useAdminGames>);

        const { container } = render(<GameLibraryTable />);
        const img = container.querySelector('img');
        expect(img).not.toBeInTheDocument();
    });

    it('applies reduced opacity to hidden game rows', () => {
        vi.mocked(useAdminGames).mockReturnValue(makeMockHook({
            games: {
                data: makeResponse([makeGame({ hidden: true })]),
                isLoading: false,
                isError: false,
            } as any,
        }) as ReturnType<typeof useAdminGames>);

        const { container } = render(<GameLibraryTable />);
        const row = container.querySelector('tr.opacity-60');
        expect(row).toBeInTheDocument();
    });
});

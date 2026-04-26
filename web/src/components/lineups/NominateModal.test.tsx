/**
 * Tests for NominateModal (ROK-935).
 * Validates search, preview, and submission flows.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/render-helpers';
import { NominateModal } from './NominateModal';

// Mock hooks
vi.mock('../../hooks/use-game-search', () => ({
    useGameSearch: vi.fn(),
}));
vi.mock('../../hooks/use-lineups', () => ({
    useNominateGame: vi.fn(),
}));

import { useGameSearch } from '../../hooks/use-game-search';
import { useNominateGame } from '../../hooks/use-lineups';

const mockMutate = vi.fn();

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useGameSearch).mockReturnValue({
        data: undefined,
        isLoading: false,
    } as ReturnType<typeof useGameSearch>);
    vi.mocked(useNominateGame).mockReturnValue({
        mutate: mockMutate,
        isPending: false,
        isError: false,
        error: null,
    } as unknown as ReturnType<typeof useNominateGame>);
});

describe('NominateModal — closed', () => {
    it('renders nothing when isOpen is false', () => {
        const { container } = renderWithProviders(
            <NominateModal isOpen={false} onClose={vi.fn()} lineupId={1} />,
        );
        expect(container.textContent).toBe('');
    });
});

describe('NominateModal — search state', () => {
    it('renders modal title "Nominate a Game"', () => {
        renderWithProviders(
            <NominateModal isOpen={true} onClose={vi.fn()} lineupId={1} />,
        );
        expect(screen.getByText('Nominate a Game')).toBeInTheDocument();
    });

    it('renders search input', () => {
        renderWithProviders(
            <NominateModal isOpen={true} onClose={vi.fn()} lineupId={1} />,
        );
        expect(screen.getByPlaceholderText(/Search by name or paste a Steam store URL/i)).toBeInTheDocument();
    });

    it('shows search results when available', () => {
        vi.mocked(useGameSearch).mockReturnValue({
            data: {
                data: [
                    { id: 42, name: 'Valheim', coverUrl: '/cover.jpg' },
                    { id: 43, name: 'Elden Ring', coverUrl: '/cover2.jpg' },
                ],
                meta: { source: 'igdb' },
            },
            isLoading: false,
        } as unknown as ReturnType<typeof useGameSearch>);

        renderWithProviders(
            <NominateModal isOpen={true} onClose={vi.fn()} lineupId={1} />,
        );
        expect(screen.getByText('Valheim')).toBeInTheDocument();
        expect(screen.getByText('Elden Ring')).toBeInTheDocument();
    });
});

describe('NominateModal — preview state', () => {
    it('shows preview card after selecting a game', async () => {
        const user = userEvent.setup();
        vi.mocked(useGameSearch).mockReturnValue({
            data: {
                data: [{ id: 42, name: 'Valheim', coverUrl: '/cover.jpg' }],
                meta: { source: 'igdb' },
            },
            isLoading: false,
        } as unknown as ReturnType<typeof useGameSearch>);

        renderWithProviders(
            <NominateModal isOpen={true} onClose={vi.fn()} lineupId={1} />,
        );

        await user.click(screen.getByText('Valheim'));
        expect(screen.getByRole('button', { name: /submit nomination/i })).toBeInTheDocument();
    });

    it('shows note textarea in preview state', async () => {
        const user = userEvent.setup();
        vi.mocked(useGameSearch).mockReturnValue({
            data: {
                data: [{ id: 42, name: 'Valheim', coverUrl: '/cover.jpg' }],
                meta: { source: 'igdb' },
            },
            isLoading: false,
        } as unknown as ReturnType<typeof useGameSearch>);

        renderWithProviders(
            <NominateModal isOpen={true} onClose={vi.fn()} lineupId={1} />,
        );

        await user.click(screen.getByText('Valheim'));
        expect(screen.getByPlaceholderText(/why this game/i)).toBeInTheDocument();
    });
});

describe('NominateModal — submission', () => {
    it('calls mutate with lineupId and selected game on submit', async () => {
        const user = userEvent.setup();
        vi.mocked(useGameSearch).mockReturnValue({
            data: {
                data: [{ id: 42, name: 'Valheim', coverUrl: '/cover.jpg' }],
                meta: { source: 'igdb' },
            },
            isLoading: false,
        } as unknown as ReturnType<typeof useGameSearch>);

        renderWithProviders(
            <NominateModal isOpen={true} onClose={vi.fn()} lineupId={5} />,
        );

        await user.click(screen.getByText('Valheim'));
        await user.click(screen.getByRole('button', { name: /submit nomination/i }));
        expect(mockMutate).toHaveBeenCalledWith(
            expect.objectContaining({ lineupId: 5, body: { gameId: 42 } }),
            expect.any(Object),
        );
    });

    it('includes note in submission when provided', async () => {
        const user = userEvent.setup();
        vi.mocked(useGameSearch).mockReturnValue({
            data: {
                data: [{ id: 42, name: 'Valheim', coverUrl: '/cover.jpg' }],
                meta: { source: 'igdb' },
            },
            isLoading: false,
        } as unknown as ReturnType<typeof useGameSearch>);

        renderWithProviders(
            <NominateModal isOpen={true} onClose={vi.fn()} lineupId={5} />,
        );

        await user.click(screen.getByText('Valheim'));
        await user.type(screen.getByPlaceholderText(/why this game/i), 'Great co-op game');
        await user.click(screen.getByRole('button', { name: /submit nomination/i }));
        expect(mockMutate).toHaveBeenCalledWith(
            expect.objectContaining({
                lineupId: 5,
                body: { gameId: 42, note: 'Great co-op game' },
            }),
            expect.any(Object),
        );
    });
});

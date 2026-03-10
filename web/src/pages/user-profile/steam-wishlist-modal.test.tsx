import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/render-helpers';
import { SteamWishlistModal } from './steam-wishlist-modal';
import type { SteamWishlistEntryDto } from '@raid-ledger/contract';

/** Create a mock Steam wishlist entry for testing */
function createMockWishlistEntry(
    overrides: Partial<SteamWishlistEntryDto> = {},
): SteamWishlistEntryDto {
    return {
        gameId: 1,
        gameName: 'Test Game',
        coverUrl: null,
        slug: 'test-game',
        dateAdded: 1700000000,
        ...overrides,
    };
}

const mockItems: SteamWishlistEntryDto[] = [
    createMockWishlistEntry({ gameId: 1, gameName: 'Elden Ring' }),
    createMockWishlistEntry({ gameId: 2, gameName: 'Hollow Knight' }),
    createMockWishlistEntry({ gameId: 3, gameName: 'Hades' }),
];

const mockModal = {
    items: mockItems,
    total: mockItems.length,
    isLoading: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    error: null,
    sentinelRef: vi.fn(),
    refetch: vi.fn(),
};

vi.mock('../../hooks/use-user-profile', () => ({
    useUserSteamWishlistModal: () => mockModal,
}));

describe('SteamWishlistModal — search filter', () => {
    const defaultProps = {
        userId: 1,
        isOpen: true,
        onClose: vi.fn(),
        total: 3,
    };

    it('renders search input when modal is open', () => {
        renderWithProviders(<SteamWishlistModal {...defaultProps} />);
        expect(
            screen.getByPlaceholderText('Search wishlist...'),
        ).toBeInTheDocument();
    });

    it('filters items by game name (case-insensitive)', async () => {
        const user = userEvent.setup();
        renderWithProviders(<SteamWishlistModal {...defaultProps} />);

        await user.type(
            screen.getByPlaceholderText('Search wishlist...'),
            'elden',
        );

        expect(screen.getByText('Elden Ring')).toBeInTheDocument();
        expect(screen.queryByText('Hollow Knight')).not.toBeInTheDocument();
        expect(screen.queryByText('Hades')).not.toBeInTheDocument();
    });

    it('shows "No games found" when filter matches nothing', async () => {
        const user = userEvent.setup();
        renderWithProviders(<SteamWishlistModal {...defaultProps} />);

        await user.type(
            screen.getByPlaceholderText('Search wishlist...'),
            'zzzzz',
        );

        expect(screen.getByText('No games found')).toBeInTheDocument();
    });

    it('shows all items when search is empty', () => {
        renderWithProviders(<SteamWishlistModal {...defaultProps} />);

        expect(screen.getByText('Elden Ring')).toBeInTheDocument();
        expect(screen.getByText('Hollow Knight')).toBeInTheDocument();
        expect(screen.getByText('Hades')).toBeInTheDocument();
    });
});

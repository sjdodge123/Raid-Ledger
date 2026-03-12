import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/render-helpers';
import { SteamWishlistModal } from './steam-wishlist-modal';
import type { SteamWishlistEntryDto, ItadGamePricingDto } from '@raid-ledger/contract';

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

/** Build a mock pricing DTO with an active discount */
function buildOnSalePricing(): ItadGamePricingDto {
    return {
        currentBest: { shop: 'Steam', url: 'https://steam.com', price: 29.99, regularPrice: 59.99, discount: 50 },
        stores: [],
        historyLow: null,
        dealQuality: 'modest',
        currency: 'USD',
        itadUrl: null,
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

const mockPricingMap = new Map<number, ItadGamePricingDto | null>();

vi.mock('../../hooks/use-user-profile', () => ({
    useUserSteamWishlistModal: () => mockModal,
}));

describe('SteamWishlistModal — search filter', () => {
    const defaultProps = {
        userId: 1,
        isOpen: true,
        onClose: vi.fn(),
        total: 3,
        pricingMap: mockPricingMap,
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

    it('renders modal title with total count', () => {
        renderWithProviders(<SteamWishlistModal {...defaultProps} />);

        expect(screen.getByText('Steam Wishlist (3)')).toBeInTheDocument();
    });

    it('filters are case-insensitive with uppercase input', async () => {
        const user = userEvent.setup();
        renderWithProviders(<SteamWishlistModal {...defaultProps} />);

        await user.type(
            screen.getByPlaceholderText('Search wishlist...'),
            'HADES',
        );

        expect(screen.getByText('Hades')).toBeInTheDocument();
        expect(screen.queryByText('Elden Ring')).not.toBeInTheDocument();
    });

    it('renders game entries as links to game pages', () => {
        renderWithProviders(<SteamWishlistModal {...defaultProps} />);

        const links = screen.getAllByRole('link');
        expect(links.length).toBeGreaterThanOrEqual(3);
        expect(links[0]).toHaveAttribute('href', '/games/1');
    });

    it('does not render when modal is closed', () => {
        renderWithProviders(
            <SteamWishlistModal {...defaultProps} isOpen={false} />,
        );

        expect(screen.queryByText('Elden Ring')).not.toBeInTheDocument();
        expect(
            screen.queryByPlaceholderText('Search wishlist...'),
        ).not.toBeInTheDocument();
    });

    it('shows partial match when search matches substring', async () => {
        const user = userEvent.setup();
        renderWithProviders(<SteamWishlistModal {...defaultProps} />);

        await user.type(
            screen.getByPlaceholderText('Search wishlist...'),
            'hollow',
        );

        expect(screen.getByText('Hollow Knight')).toBeInTheDocument();
        expect(screen.queryByText('Elden Ring')).not.toBeInTheDocument();
        expect(screen.queryByText('Hades')).not.toBeInTheDocument();
    });

    it('renders pricing badges when pricing data is available', () => {
        mockPricingMap.set(1, buildOnSalePricing());

        renderWithProviders(<SteamWishlistModal {...defaultProps} />);

        expect(screen.getByText('On Sale')).toBeInTheDocument();

        mockPricingMap.clear();
    });

    it('renders no pricing badges when pricing map is empty', () => {
        mockPricingMap.clear();

        renderWithProviders(<SteamWishlistModal {...defaultProps} />);

        expect(screen.queryByText('On Sale')).not.toBeInTheDocument();
        expect(screen.queryByText('Best Price')).not.toBeInTheDocument();
    });
});

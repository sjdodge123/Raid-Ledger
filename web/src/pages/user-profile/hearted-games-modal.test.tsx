import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/render-helpers';
import { HeartedGamesModal } from './hearted-games-modal';
import type { UserHeartedGameDto, ItadGamePricingDto } from '@raid-ledger/contract';

/** Create a mock hearted game for testing */
function createMockHeartedGame(overrides: Partial<UserHeartedGameDto> = {}): UserHeartedGameDto {
    return {
        id: 1,
        igdbId: 100,
        name: 'Test Game',
        slug: 'test-game',
        coverUrl: null,
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

const mockItems: UserHeartedGameDto[] = [
    createMockHeartedGame({ id: 1, name: 'World of Warcraft' }),
    createMockHeartedGame({ id: 2, name: 'Final Fantasy XIV' }),
    createMockHeartedGame({ id: 3, name: 'Lost Ark' }),
    createMockHeartedGame({ id: 4, name: 'Warframe' }),
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
    useUserHeartedGamesModal: () => mockModal,
}));

describe('HeartedGamesModal — search filter', () => {
    const defaultProps = {
        userId: 1,
        isOpen: true,
        onClose: vi.fn(),
        total: 4,
        pricingMap: mockPricingMap,
    };

    it('renders search input when modal is open', () => {
        renderWithProviders(<HeartedGamesModal {...defaultProps} />);
        expect(screen.getByPlaceholderText('Search games...')).toBeInTheDocument();
    });

    it('filters items by game name (case-insensitive)', async () => {
        const user = userEvent.setup();
        renderWithProviders(<HeartedGamesModal {...defaultProps} />);

        await user.type(screen.getByPlaceholderText('Search games...'), 'war');

        expect(screen.getByText('World of Warcraft')).toBeInTheDocument();
        expect(screen.getByText('Warframe')).toBeInTheDocument();
        expect(screen.queryByText('Final Fantasy XIV')).not.toBeInTheDocument();
        expect(screen.queryByText('Lost Ark')).not.toBeInTheDocument();
    });

    it('shows "No games found" when filter produces zero matches', async () => {
        const user = userEvent.setup();
        renderWithProviders(<HeartedGamesModal {...defaultProps} />);

        await user.type(screen.getByPlaceholderText('Search games...'), 'zzzzz');

        expect(screen.getByText('No games found')).toBeInTheDocument();
    });

    it('clears search when modal closes and reopens', () => {
        const onClose = vi.fn();
        const { unmount } = renderWithProviders(
            <HeartedGamesModal {...defaultProps} onClose={onClose} />,
        );
        unmount();

        renderWithProviders(<HeartedGamesModal {...defaultProps} />);
        const input = screen.getByPlaceholderText('Search games...') as HTMLInputElement;
        expect(input.value).toBe('');
    });

    it('shows all items when search is empty', () => {
        renderWithProviders(<HeartedGamesModal {...defaultProps} />);

        expect(screen.getByText('World of Warcraft')).toBeInTheDocument();
        expect(screen.getByText('Final Fantasy XIV')).toBeInTheDocument();
        expect(screen.getByText('Lost Ark')).toBeInTheDocument();
        expect(screen.getByText('Warframe')).toBeInTheDocument();
    });

    it('renders pricing badges when pricing data is available', () => {
        mockPricingMap.set(1, buildOnSalePricing());

        renderWithProviders(<HeartedGamesModal {...defaultProps} />);

        expect(screen.getByText('On Sale')).toBeInTheDocument();

        mockPricingMap.clear();
    });

    it('renders no pricing badges when pricing map is empty', () => {
        mockPricingMap.clear();

        renderWithProviders(<HeartedGamesModal {...defaultProps} />);

        expect(screen.queryByText('On Sale')).not.toBeInTheDocument();
        expect(screen.queryByText('Best Price')).not.toBeInTheDocument();
    });
});

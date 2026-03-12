import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/render-helpers';
import { SteamLibraryModal } from './steam-library-modal';
import type { SteamLibraryEntryDto, ItadGamePricingDto } from '@raid-ledger/contract';

/** Create a mock Steam library entry for testing */
function createMockSteamEntry(overrides: Partial<SteamLibraryEntryDto> = {}): SteamLibraryEntryDto {
    return {
        gameId: 1,
        gameName: 'Test Game',
        coverUrl: null,
        slug: 'test-game',
        playtimeSeconds: 3600,
        playtime2weeksSeconds: null,
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

const mockItems: SteamLibraryEntryDto[] = [
    createMockSteamEntry({ gameId: 1, gameName: 'Counter-Strike 2' }),
    createMockSteamEntry({ gameId: 2, gameName: 'Dota 2' }),
    createMockSteamEntry({ gameId: 3, gameName: 'Team Fortress 2' }),
    createMockSteamEntry({ gameId: 4, gameName: 'Portal 2' }),
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
    useUserSteamLibraryModal: () => mockModal,
}));

vi.mock('../../lib/activity-utils', () => ({
    formatPlaytime: (seconds: number) => `${Math.round(seconds / 3600)}h`,
}));

vi.mock('../../hooks/use-games-pricing-batch', () => ({
    useGamesPricingBatch: () => mockPricingMap,
}));

describe('SteamLibraryModal — search filter', () => {
    const defaultProps = {
        userId: 1,
        isOpen: true,
        onClose: vi.fn(),
        total: 4,
    };

    it('renders search input when modal is open', () => {
        renderWithProviders(<SteamLibraryModal {...defaultProps} />);
        expect(screen.getByPlaceholderText('Search games...')).toBeInTheDocument();
    });

    it('filters items by game name (case-insensitive)', async () => {
        const user = userEvent.setup();
        renderWithProviders(<SteamLibraryModal {...defaultProps} />);

        await user.type(screen.getByPlaceholderText('Search games...'), 'counter');

        expect(screen.getByText('Counter-Strike 2')).toBeInTheDocument();
        expect(screen.queryByText('Dota 2')).not.toBeInTheDocument();
        expect(screen.queryByText('Team Fortress 2')).not.toBeInTheDocument();
        expect(screen.queryByText('Portal 2')).not.toBeInTheDocument();
    });

    it('shows "No games found" when filter produces zero matches', async () => {
        const user = userEvent.setup();
        renderWithProviders(<SteamLibraryModal {...defaultProps} />);

        await user.type(screen.getByPlaceholderText('Search games...'), 'zzzzz');

        expect(screen.getByText('No games found')).toBeInTheDocument();
    });

    it('clears search when modal closes and reopens', () => {
        const onClose = vi.fn();
        const { unmount } = renderWithProviders(
            <SteamLibraryModal {...defaultProps} onClose={onClose} />,
        );
        unmount();

        renderWithProviders(<SteamLibraryModal {...defaultProps} />);
        const input = screen.getByPlaceholderText('Search games...') as HTMLInputElement;
        expect(input.value).toBe('');
    });

    it('shows all items when search is empty', () => {
        renderWithProviders(<SteamLibraryModal {...defaultProps} />);

        expect(screen.getByText('Counter-Strike 2')).toBeInTheDocument();
        expect(screen.getByText('Dota 2')).toBeInTheDocument();
        expect(screen.getByText('Team Fortress 2')).toBeInTheDocument();
        expect(screen.getByText('Portal 2')).toBeInTheDocument();
    });

    it('renders pricing badges when pricing data is available', () => {
        mockPricingMap.set(1, buildOnSalePricing());

        renderWithProviders(<SteamLibraryModal {...defaultProps} />);

        expect(screen.getByText('On Sale')).toBeInTheDocument();

        mockPricingMap.clear();
    });

    it('renders no pricing badges when pricing map is empty', () => {
        mockPricingMap.clear();

        renderWithProviders(<SteamLibraryModal {...defaultProps} />);

        expect(screen.queryByText('On Sale')).not.toBeInTheDocument();
        expect(screen.queryByText('Best Price')).not.toBeInTheDocument();
    });
});

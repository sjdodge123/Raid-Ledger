import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/render-helpers';
import { SteamWishlistSection } from './steam-wishlist-section';

const mockUseUserSteamWishlist = vi.fn();

vi.mock('../../hooks/use-user-profile', () => ({
    useUserSteamWishlist: (...args: unknown[]) =>
        mockUseUserSteamWishlist(...args),
}));

vi.mock('./steam-wishlist-modal', () => ({
    SteamWishlistModal: ({
        isOpen,
    }: {
        isOpen: boolean;
        onClose: () => void;
        userId: number;
        total: number;
    }) => (isOpen ? <div data-testid="wishlist-modal">Modal Open</div> : null),
}));

function createEntry(
    id: number,
    name: string,
) {
    return {
        gameId: id,
        gameName: name,
        coverUrl: null,
        slug: name.toLowerCase().replace(/\s+/g, '-'),
        dateAdded: 1700000000,
    };
}

describe('SteamWishlistSection', () => {
    it('renders nothing when items are empty and not loading', () => {
        mockUseUserSteamWishlist.mockReturnValue({
            data: { data: [], meta: { total: 0 } },
            isLoading: false,
        });

        const { container } = renderWithProviders(
            <SteamWishlistSection userId={1} />,
        );

        expect(container.innerHTML).toBe('');
    });

    it('renders section title with total count', () => {
        const items = [createEntry(1, 'Elden Ring')];
        mockUseUserSteamWishlist.mockReturnValue({
            data: { data: items, meta: { total: 5 } },
            isLoading: false,
        });

        renderWithProviders(<SteamWishlistSection userId={1} />);

        expect(screen.getByText(/Steam Wishlist/)).toBeInTheDocument();
        expect(screen.getByText(/\(5\)/)).toBeInTheDocument();
    });

    it('renders game entries as links', () => {
        const items = [
            createEntry(1, 'Elden Ring'),
            createEntry(2, 'Hollow Knight'),
        ];
        mockUseUserSteamWishlist.mockReturnValue({
            data: { data: items, meta: { total: 2 } },
            isLoading: false,
        });

        renderWithProviders(<SteamWishlistSection userId={1} />);

        expect(screen.getByText('Elden Ring')).toBeInTheDocument();
        expect(screen.getByText('Hollow Knight')).toBeInTheDocument();
    });

    it('does not show "Show All" button when total <= 10', () => {
        const items = [createEntry(1, 'Game 1')];
        mockUseUserSteamWishlist.mockReturnValue({
            data: { data: items, meta: { total: 5 } },
            isLoading: false,
        });

        renderWithProviders(<SteamWishlistSection userId={1} />);

        expect(
            screen.queryByRole('button', { name: /show all/i }),
        ).not.toBeInTheDocument();
    });

    it('shows "Show All" button when total > 10', () => {
        const items = Array.from({ length: 10 }, (_, i) =>
            createEntry(i + 1, `Game ${i + 1}`),
        );
        mockUseUserSteamWishlist.mockReturnValue({
            data: { data: items, meta: { total: 25 } },
            isLoading: false,
        });

        renderWithProviders(<SteamWishlistSection userId={1} />);

        expect(screen.getByText(/Show All \(25\)/)).toBeInTheDocument();
    });

    it('opens modal when "Show All" button is clicked', async () => {
        const user = userEvent.setup();
        const items = Array.from({ length: 10 }, (_, i) =>
            createEntry(i + 1, `Game ${i + 1}`),
        );
        mockUseUserSteamWishlist.mockReturnValue({
            data: { data: items, meta: { total: 25 } },
            isLoading: false,
        });

        renderWithProviders(<SteamWishlistSection userId={1} />);

        await user.click(screen.getByText(/Show All \(25\)/));

        expect(screen.getByTestId('wishlist-modal')).toBeInTheDocument();
    });

    it('does not show total in title when total is 0', () => {
        const items = [createEntry(1, 'Some Game')];
        mockUseUserSteamWishlist.mockReturnValue({
            data: { data: items, meta: { total: 0 } },
            isLoading: false,
        });

        renderWithProviders(<SteamWishlistSection userId={1} />);

        const heading = screen.getByText(/Steam Wishlist/);
        expect(heading.textContent).toBe('Steam Wishlist');
    });

    it('renders placeholder for games without cover image', () => {
        const items = [createEntry(1, 'No Cover Game')];
        mockUseUserSteamWishlist.mockReturnValue({
            data: { data: items, meta: { total: 1 } },
            isLoading: false,
        });

        renderWithProviders(<SteamWishlistSection userId={1} />);

        expect(screen.getByText('?')).toBeInTheDocument();
    });

    it('renders cover image when coverUrl is provided', () => {
        const items = [
            {
                ...createEntry(1, 'With Cover'),
                coverUrl: 'https://example.com/cover.jpg',
            },
        ];
        mockUseUserSteamWishlist.mockReturnValue({
            data: { data: items, meta: { total: 1 } },
            isLoading: false,
        });

        renderWithProviders(<SteamWishlistSection userId={1} />);

        const img = screen.getByAltText('With Cover');
        expect(img).toBeInTheDocument();
        expect(img).toHaveAttribute('src', 'https://example.com/cover.jpg');
    });
});

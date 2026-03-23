/**
 * Tests for CommonGroundGameCard (ROK-934).
 * Validates badge rendering, cover image, and nominate button states.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CommonGroundGameDto } from '@raid-ledger/contract';
import { CommonGroundGameCard } from './CommonGroundGameCard';

function buildGame(overrides: Partial<CommonGroundGameDto> = {}): CommonGroundGameDto {
    return {
        gameId: 42,
        gameName: 'Valheim',
        slug: 'valheim',
        coverUrl: 'https://images.igdb.com/cover.jpg',
        ownerCount: 5,
        wishlistCount: 2,
        nonOwnerPrice: 19.99,
        itadCurrentCut: 25,
        itadCurrentShop: 'Steam',
        itadCurrentUrl: 'https://store.steampowered.com/app/892970',
        earlyAccess: false,
        itadTags: ['survival', 'co-op'],
        playerCount: { min: 1, max: 10 },
        score: 85,
        ...overrides,
    };
}

describe('CommonGroundGameCard — rendering', () => {
    it('renders game name', () => {
        render(
            <CommonGroundGameCard
                game={buildGame()}
                onNominate={vi.fn()}
                isNominating={false}
                atCap={false}
            />,
        );
        expect(screen.getByText('Valheim')).toBeInTheDocument();
    });

    it('renders cover image with alt text', () => {
        render(
            <CommonGroundGameCard
                game={buildGame()}
                onNominate={vi.fn()}
                isNominating={false}
                atCap={false}
            />,
        );
        const img = screen.getByAltText('Valheim');
        expect(img).toBeInTheDocument();
        expect(img).toHaveAttribute('src', 'https://images.igdb.com/cover.jpg');
    });

    it('renders placeholder when coverUrl is null', () => {
        const { container } = render(
            <CommonGroundGameCard
                game={buildGame({ coverUrl: null })}
                onNominate={vi.fn()}
                isNominating={false}
                atCap={false}
            />,
        );
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
        // Placeholder SVG should be present
        expect(container.querySelector('svg')).toBeInTheDocument();
    });
});

describe('CommonGroundGameCard — owner badge', () => {
    it('shows owner count badge with correct count', () => {
        render(
            <CommonGroundGameCard
                game={buildGame({ ownerCount: 7 })}
                onNominate={vi.fn()}
                isNominating={false}
                atCap={false}
            />,
        );
        expect(screen.getByText('7 own')).toBeInTheDocument();
    });

    it('shows owner count of 0', () => {
        render(
            <CommonGroundGameCard
                game={buildGame({ ownerCount: 0 })}
                onNominate={vi.fn()}
                isNominating={false}
                atCap={false}
            />,
        );
        expect(screen.getByText('0 own')).toBeInTheDocument();
    });
});

describe('CommonGroundGameCard — wishlist badge', () => {
    it('shows wishlist badge when count > 0', () => {
        render(
            <CommonGroundGameCard
                game={buildGame({ wishlistCount: 3 })}
                onNominate={vi.fn()}
                isNominating={false}
                atCap={false}
            />,
        );
        expect(screen.getByText('3 wishlisted')).toBeInTheDocument();
    });

    it('hides wishlist badge when count is 0', () => {
        render(
            <CommonGroundGameCard
                game={buildGame({ wishlistCount: 0 })}
                onNominate={vi.fn()}
                isNominating={false}
                atCap={false}
            />,
        );
        expect(screen.queryByText(/wishlisted/)).not.toBeInTheDocument();
    });
});

describe('CommonGroundGameCard — sale badge', () => {
    it('shows sale badge with discount percentage when itadCurrentCut > 0', () => {
        render(
            <CommonGroundGameCard
                game={buildGame({ itadCurrentCut: 40, nonOwnerPrice: 11.99 })}
                onNominate={vi.fn()}
                isNominating={false}
                atCap={false}
            />,
        );
        expect(screen.getByText('-40% $11.99')).toBeInTheDocument();
    });

    it('shows discount without price when nonOwnerPrice is null', () => {
        render(
            <CommonGroundGameCard
                game={buildGame({ itadCurrentCut: 30, nonOwnerPrice: null })}
                onNominate={vi.fn()}
                isNominating={false}
                atCap={false}
            />,
        );
        expect(screen.getByText('-30%')).toBeInTheDocument();
    });

    it('shows plain price when itadCurrentCut is 0 and price is set', () => {
        render(
            <CommonGroundGameCard
                game={buildGame({ itadCurrentCut: 0, nonOwnerPrice: 29.99 })}
                onNominate={vi.fn()}
                isNominating={false}
                atCap={false}
            />,
        );
        expect(screen.getByText('$29.99')).toBeInTheDocument();
    });

    it('shows plain price when itadCurrentCut is null and price is set', () => {
        render(
            <CommonGroundGameCard
                game={buildGame({ itadCurrentCut: null, nonOwnerPrice: 14.99 })}
                onNominate={vi.fn()}
                isNominating={false}
                atCap={false}
            />,
        );
        expect(screen.getByText('$14.99')).toBeInTheDocument();
    });

    it('hides sale badge when both cut and price are null', () => {
        render(
            <CommonGroundGameCard
                game={buildGame({ itadCurrentCut: null, nonOwnerPrice: null })}
                onNominate={vi.fn()}
                isNominating={false}
                atCap={false}
            />,
        );
        // No sale or price badge at all
        expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
        expect(screen.queryByText(/-%/)).not.toBeInTheDocument();
    });
});

describe('CommonGroundGameCard — early access badge', () => {
    it('shows early access badge when earlyAccess is true', () => {
        render(
            <CommonGroundGameCard
                game={buildGame({ earlyAccess: true })}
                onNominate={vi.fn()}
                isNominating={false}
                atCap={false}
            />,
        );
        expect(screen.getByText('Early Access')).toBeInTheDocument();
    });

    it('hides early access badge when earlyAccess is false', () => {
        render(
            <CommonGroundGameCard
                game={buildGame({ earlyAccess: false })}
                onNominate={vi.fn()}
                isNominating={false}
                atCap={false}
            />,
        );
        expect(screen.queryByText('Early Access')).not.toBeInTheDocument();
    });
});

describe('CommonGroundGameCard — nominate button', () => {
    it('shows "+ Nominate" button by default', () => {
        render(
            <CommonGroundGameCard
                game={buildGame()}
                onNominate={vi.fn()}
                isNominating={false}
                atCap={false}
            />,
        );
        expect(screen.getByRole('button', { name: '+ Nominate' })).toBeInTheDocument();
    });

    it('calls onNominate with gameId when clicked', async () => {
        const user = userEvent.setup();
        const onNominate = vi.fn();
        render(
            <CommonGroundGameCard
                game={buildGame({ gameId: 99 })}
                onNominate={onNominate}
                isNominating={false}
                atCap={false}
            />,
        );
        await user.click(screen.getByRole('button', { name: '+ Nominate' }));
        expect(onNominate).toHaveBeenCalledWith(99);
        expect(onNominate).toHaveBeenCalledTimes(1);
    });

    it('shows "Lineup full" and is disabled when atCap is true', () => {
        render(
            <CommonGroundGameCard
                game={buildGame()}
                onNominate={vi.fn()}
                isNominating={false}
                atCap={true}
            />,
        );
        const button = screen.getByRole('button', { name: 'Lineup full' });
        expect(button).toBeDisabled();
    });

    it('shows "Adding..." and is disabled when isNominating is true', () => {
        render(
            <CommonGroundGameCard
                game={buildGame()}
                onNominate={vi.fn()}
                isNominating={true}
                atCap={false}
            />,
        );
        const button = screen.getByRole('button', { name: 'Adding...' });
        expect(button).toBeDisabled();
    });

    it('does not call onNominate when button is disabled (atCap)', async () => {
        const user = userEvent.setup();
        const onNominate = vi.fn();
        render(
            <CommonGroundGameCard
                game={buildGame()}
                onNominate={onNominate}
                isNominating={false}
                atCap={true}
            />,
        );
        await user.click(screen.getByRole('button', { name: 'Lineup full' }));
        expect(onNominate).not.toHaveBeenCalled();
    });
});

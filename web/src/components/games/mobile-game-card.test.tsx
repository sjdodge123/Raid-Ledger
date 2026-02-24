import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MobileGameCard } from './mobile-game-card';
import type { GameDetailDto } from '@raid-ledger/contract';

// Mock auth hook
vi.mock('../../hooks/use-auth', () => ({
    useAuth: () => ({ isAuthenticated: true, user: { id: 1 } }),
}));

// Mock want-to-play hook
vi.mock('../../hooks/use-want-to-play', () => ({
    useWantToPlay: () => ({
        wantToPlay: false,
        count: 3,
        toggle: vi.fn(),
        isToggling: false,
    }),
}));

const createMockGame = (overrides: Partial<GameDetailDto> = {}): GameDetailDto => ({
    id: 100,
    igdbId: 1001,
    name: 'World of Warcraft',
    slug: 'world-of-warcraft',
    coverUrl: 'https://example.com/wow-cover.jpg',
    genres: [36], // MOBA
    gameModes: [5], // MMO
    summary: 'A massively multiplayer online role-playing game',
    rating: 85,
    aggregatedRating: 90,
    popularity: 95,
    themes: [],
    platforms: [],
    screenshots: [],
    videos: [],
    firstReleaseDate: '2004-11-23T00:00:00Z',
    playerCount: null,
    twitchGameId: null,
    crossplay: null,
    ...overrides,
});

function renderWithRouter(ui: React.ReactElement) {
    return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('MobileGameCard', () => {
    it('renders game name', () => {
        renderWithRouter(<MobileGameCard game={createMockGame()} />);
        expect(screen.getByText('World of Warcraft')).toBeInTheDocument();
    });

    it('renders rating badge', () => {
        renderWithRouter(<MobileGameCard game={createMockGame()} />);
        expect(screen.getByTestId('mobile-game-rating')).toHaveTextContent('90');
    });

    it('renders genre tag', () => {
        renderWithRouter(<MobileGameCard game={createMockGame()} />);
        expect(screen.getByTestId('mobile-game-genre')).toHaveTextContent('MOBA');
    });

    it('renders heart button when authenticated', () => {
        renderWithRouter(<MobileGameCard game={createMockGame()} />);
        expect(screen.getByTestId('mobile-game-heart')).toBeInTheDocument();
    });

    it('heart button has ≥44px tap target', () => {
        renderWithRouter(<MobileGameCard game={createMockGame()} />);
        const heart = screen.getByTestId('mobile-game-heart');
        // w-11 = 44px, h-11 = 44px
        expect(heart.className).toContain('w-11');
        expect(heart.className).toContain('h-11');
    });

    it('links to game detail page', () => {
        renderWithRouter(<MobileGameCard game={createMockGame()} />);
        const link = screen.getByTestId('mobile-game-card');
        expect(link).toHaveAttribute('href', '/games/100');
    });

    it('does not render rating badge when no rating', () => {
        renderWithRouter(<MobileGameCard game={createMockGame({ rating: null, aggregatedRating: null })} />);
        expect(screen.queryByTestId('mobile-game-rating')).not.toBeInTheDocument();
    });

    it('does not render genre tag when no genres', () => {
        renderWithRouter(<MobileGameCard game={createMockGame({ genres: [] })} />);
        expect(screen.queryByTestId('mobile-game-genre')).not.toBeInTheDocument();
    });
});

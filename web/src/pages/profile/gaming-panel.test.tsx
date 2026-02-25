/**
 * Unit tests for the consolidated GamingPanel (ROK-359).
 * Verifies tab structure renders and switching between tabs works.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GamingPanel } from './gaming-panel';

// Mock all sub-components to isolate tab rendering
vi.mock('../../hooks/use-auth', () => ({
    useAuth: () => ({ isAuthenticated: true }),
}));

vi.mock('../../hooks/use-characters', () => ({
    useMyCharacters: () => ({ data: { data: [] }, isLoading: false }),
}));

vi.mock('../../hooks/use-game-registry', () => ({
    useGameRegistry: () => ({ games: [] }),
}));

vi.mock('../../components/features/game-time', () => ({
    GameTimePanel: () => <div data-testid="game-time-panel">Game Time Content</div>,
}));

vi.mock('../../components/profile', () => ({
    CharacterList: () => <div data-testid="character-list">Character List</div>,
    AddCharacterModal: () => null,
}));

vi.mock('../../components/profile/my-watched-games-section', () => ({
    MyWatchedGamesSection: () => <div data-testid="watched-games-section">Watched Games</div>,
}));

describe('GamingPanel (ROK-359)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders three tab buttons: Game Time, Characters, Watched Games', () => {
        render(<GamingPanel />);
        expect(screen.getByRole('button', { name: /game time/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /characters/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /watched games/i })).toBeInTheDocument();
    });

    it('shows Game Time tab content by default', () => {
        render(<GamingPanel />);
        expect(screen.getByTestId('game-time-panel')).toBeInTheDocument();
    });

    it('does not show Characters content by default', () => {
        render(<GamingPanel />);
        expect(screen.queryByTestId('character-list')).not.toBeInTheDocument();
    });

    it('does not show Watched Games content by default', () => {
        render(<GamingPanel />);
        expect(screen.queryByTestId('watched-games-section')).not.toBeInTheDocument();
    });

    it('switches to Characters tab when clicked', async () => {
        const user = userEvent.setup();
        render(<GamingPanel />);
        await user.click(screen.getByRole('button', { name: /characters/i }));
        expect(screen.getByTestId('character-list')).toBeInTheDocument();
        expect(screen.queryByTestId('game-time-panel')).not.toBeInTheDocument();
    });

    it('switches to Watched Games tab when clicked', async () => {
        const user = userEvent.setup();
        render(<GamingPanel />);
        await user.click(screen.getByRole('button', { name: /watched games/i }));
        expect(screen.getByTestId('watched-games-section')).toBeInTheDocument();
        expect(screen.queryByTestId('game-time-panel')).not.toBeInTheDocument();
    });

    it('switches back to Game Time tab from another tab', async () => {
        const user = userEvent.setup();
        render(<GamingPanel />);
        await user.click(screen.getByRole('button', { name: /characters/i }));
        await user.click(screen.getByRole('button', { name: /game time/i }));
        expect(screen.getByTestId('game-time-panel')).toBeInTheDocument();
        expect(screen.queryByTestId('character-list')).not.toBeInTheDocument();
    });
});

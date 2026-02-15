import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MobilePlayerCard } from './mobile-player-card';
import type { UserPreviewDto } from '@raid-ledger/contract';

const createMockPlayer = (overrides: Partial<UserPreviewDto> = {}): UserPreviewDto => ({
    id: 42,
    username: 'TestPlayer',
    avatar: null,
    ...overrides,
});

function renderWithRouter(ui: React.ReactElement) {
    return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('MobilePlayerCard', () => {
    it('renders username', () => {
        renderWithRouter(<MobilePlayerCard player={createMockPlayer()} />);
        expect(screen.getByText('TestPlayer')).toBeInTheDocument();
    });

    it('shows letter fallback when no avatar', () => {
        renderWithRouter(<MobilePlayerCard player={createMockPlayer()} />);
        expect(screen.getByText('T')).toBeInTheDocument();
    });

    it('shows avatar image when URL available', () => {
        renderWithRouter(
            <MobilePlayerCard player={createMockPlayer({ avatar: 'https://cdn.example.com/avatar.png' })} />,
        );
        expect(screen.getByAltText('TestPlayer')).toBeInTheDocument();
    });

    it('links to player profile', () => {
        renderWithRouter(<MobilePlayerCard player={createMockPlayer()} />);
        const link = screen.getByTestId('mobile-player-card');
        expect(link).toHaveAttribute('href', '/users/42');
    });

    it('truncates long usernames', () => {
        renderWithRouter(
            <MobilePlayerCard player={createMockPlayer({ username: 'VeryLongUsernameForTesting' })} />,
        );
        const nameEl = screen.getByText('VeryLongUsernameForTesting');
        expect(nameEl.className).toContain('truncate');
    });
});

/**
 * Accessibility (axe-core) tests for UnifiedGameCard (ROK-881).
 * Ensures both link and toggle variants have zero critical/serious violations.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { axe } from 'vitest-axe';
import { UnifiedGameCard } from './unified-game-card';

vi.mock('../../hooks/use-auth', () => ({
    useAuth: () => ({ isAuthenticated: false, user: null }),
}));

vi.mock('../../hooks/use-want-to-play', () => ({
    useWantToPlay: () => ({
        wantToPlay: false,
        count: 0,
        toggle: vi.fn(),
        isToggling: false,
    }),
}));

function createGame() {
    return {
        id: 1,
        name: 'Elden Ring',
        slug: 'elden-ring',
        coverUrl: 'https://example.com/cover.jpg',
        genres: [12],
        aggregatedRating: 95,
        rating: 92,
        gameModes: [1],
    };
}

describe('UnifiedGameCard — axe accessibility (ROK-881)', () => {
    it('link variant has no accessibility violations', async () => {
        const { container } = render(
            <MemoryRouter>
                <UnifiedGameCard variant="link" game={createGame()} />
            </MemoryRouter>,
        );
        expect(await axe(container)).toHaveNoViolations();
    });

    it('toggle variant (unselected) has no accessibility violations', async () => {
        const { container } = render(
            <MemoryRouter>
                <UnifiedGameCard
                    variant="toggle"
                    game={createGame()}
                    selected={false}
                    onToggle={vi.fn()}
                />
            </MemoryRouter>,
        );
        expect(await axe(container)).toHaveNoViolations();
    });

    it('toggle variant (selected) has no accessibility violations', async () => {
        const { container } = render(
            <MemoryRouter>
                <UnifiedGameCard
                    variant="toggle"
                    game={createGame()}
                    selected={true}
                    onToggle={vi.fn()}
                />
            </MemoryRouter>,
        );
        expect(await axe(container)).toHaveNoViolations();
    });
});

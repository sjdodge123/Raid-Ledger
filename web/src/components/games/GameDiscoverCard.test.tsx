/**
 * Regression test for GameDiscoverCard (ROK-1342, operator decision
 * 2026-06-02): the desktop discover card must NOT render a research (i)
 * affordance. UnifiedGameCard is stubbed so this asserts GameDiscoverCard
 * itself adds no (i) trigger (desktop research is the full /games/:id page via
 * the card body).
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GameDiscoverCard } from './GameDiscoverCard';
import type { GameDetailDto } from '@raid-ledger/contract';

vi.mock('./unified-game-card', () => ({
    UnifiedGameCard: () => <div data-testid="unified-game-card-stub" />,
}));

function createGame(overrides: Partial<GameDetailDto> = {}): GameDetailDto {
    return {
        id: 1,
        name: 'Elden Ring',
        coverUrl: 'https://example.com/cover.jpg',
        genres: [12],
        aggregatedRating: 95,
        rating: 92,
        ...overrides,
    } as GameDetailDto;
}

describe('Regression: ROK-1342 — desktop discover card has no (i) affordance', () => {
    it('renders the unified card without a research (i) trigger', () => {
        const { container, getByTestId } = render(
            <MemoryRouter>
                <GameDiscoverCard game={createGame()} pricing={null} />
            </MemoryRouter>,
        );
        getByTestId('unified-game-card-stub');
        expect(container.querySelector('[data-testid="game-ref-info-affordance"]')).toBeNull();
        expect(container.querySelector('[title="Open game research"]')).toBeNull();
    });
});

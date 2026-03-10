import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SectionedGameList } from './CalendarGameFilter';
import type { GameWithLiked } from './game-filter-helpers';

vi.mock('../../constants/game-colors', () => ({
    getGameColors: () => ({ bg: '#000', border: '#111', icon: 'X' }),
}));

function makeGame(slug: string, name: string, liked: boolean): GameWithLiked {
    return { slug, name, coverUrl: null, liked };
}

describe('SectionedGameList', () => {
    it('renders section header for liked games', () => {
        const games = [
            makeGame('wow', 'World of Warcraft', true),
            makeGame('eso', 'Elder Scrolls Online', false),
        ];
        render(
            <SectionedGameList
                games={games}
                selectedGames={new Set(['wow', 'eso'])}
                toggleGame={vi.fn()}
            />,
        );

        expect(screen.getByText('Your Games')).toBeInTheDocument();
    });

    it('renders section header for other games', () => {
        const games = [
            makeGame('wow', 'World of Warcraft', true),
            makeGame('eso', 'Elder Scrolls Online', false),
        ];
        render(
            <SectionedGameList
                games={games}
                selectedGames={new Set(['wow'])}
                toggleGame={vi.fn()}
            />,
        );

        expect(screen.getByText('Other Games')).toBeInTheDocument();
    });

    it('does not render section headers when no liked games', () => {
        const games = [
            makeGame('wow', 'World of Warcraft', false),
            makeGame('eso', 'Elder Scrolls Online', false),
        ];
        render(
            <SectionedGameList
                games={games}
                selectedGames={new Set()}
                toggleGame={vi.fn()}
            />,
        );

        expect(screen.queryByText('Your Games')).not.toBeInTheDocument();
        expect(screen.queryByText('Other Games')).not.toBeInTheDocument();
    });

    it('does not render "Other Games" header when all games are liked', () => {
        const games = [
            makeGame('wow', 'World of Warcraft', true),
            makeGame('eso', 'Elder Scrolls Online', true),
        ];
        render(
            <SectionedGameList
                games={games}
                selectedGames={new Set(['wow', 'eso'])}
                toggleGame={vi.fn()}
            />,
        );

        expect(screen.getByText('Your Games')).toBeInTheDocument();
        expect(screen.queryByText('Other Games')).not.toBeInTheDocument();
    });

    it('renders all game names', () => {
        const games = [
            makeGame('wow', 'World of Warcraft', true),
            makeGame('eso', 'Elder Scrolls Online', false),
        ];
        render(
            <SectionedGameList
                games={games}
                selectedGames={new Set(['wow'])}
                toggleGame={vi.fn()}
            />,
        );

        expect(screen.getByText('World of Warcraft')).toBeInTheDocument();
        expect(screen.getByText('Elder Scrolls Online')).toBeInTheDocument();
    });
});

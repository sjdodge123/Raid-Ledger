import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CalendarGameFilterControls, SectionedGameList } from './CalendarGameFilter';
import type { GameWithLiked } from './game-filter-helpers';

vi.mock('../../constants/game-colors', () => ({
    getGameColors: () => ({ bg: '#000', border: '#111', icon: 'X' }),
}));

function makeGame(slug: string, name: string, liked: boolean): GameWithLiked {
    return { slug, name, coverUrl: null, liked };
}

describe('CalendarGameFilterControls (ROK-1662)', () => {
    const games = [{ slug: 'wow', name: 'World of Warcraft', coverUrl: null }, { slug: 'apex', name: 'Apex Legends', coverUrl: null }];

    it('search narrows the list and says when nothing matches', () => {
        render(<CalendarGameFilterControls allKnownGames={games} selectedGames={new Set(['wow', 'apex'])}
            toggleGame={vi.fn()} deselectAllGames={vi.fn()} layout="panel" />);
        fireEvent.change(screen.getByRole('searchbox', { name: 'Search games' }), { target: { value: 'apex' } });
        expect(screen.getByText('Apex Legends')).toBeInTheDocument();
        expect(screen.queryByText('World of Warcraft')).toBeNull();
        fireEvent.change(screen.getByRole('searchbox', { name: 'Search games' }), { target: { value: 'zzz' } });
        expect(screen.getByText('No games match your search.')).toBeInTheDocument();
    });

    it('shows "N of M selected" counting known games only, and None hides every game', () => {
        const deselectAll = vi.fn();
        render(<CalendarGameFilterControls allKnownGames={games} selectedGames={new Set(['wow', 'stale-slug'])}
            toggleGame={vi.fn()} deselectAllGames={deselectAll} layout="sheet" />);
        expect(screen.getByText('1 of 2 selected')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'None' }));
        expect(deselectAll).toHaveBeenCalledTimes(1);
    });

    it('sheet rows are tap buttons with aria-pressed; panel rows are checkboxes', () => {
        const { unmount } = render(<CalendarGameFilterControls allKnownGames={games} selectedGames={new Set(['wow'])}
            toggleGame={vi.fn()} deselectAllGames={vi.fn()} layout="sheet" />);
        expect(screen.getByRole('button', { name: 'World of Warcraft' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Apex Legends' })).toHaveAttribute('aria-pressed', 'false');
        unmount();
        render(<CalendarGameFilterControls allKnownGames={games} selectedGames={new Set(['wow'])}
            toggleGame={vi.fn()} deselectAllGames={vi.fn()} layout="panel" />);
        expect(screen.getByRole('checkbox', { name: 'World of Warcraft' })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'Apex Legends' })).not.toBeChecked();
    });
});

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

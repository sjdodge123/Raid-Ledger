import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SectionedGameList } from './CalendarGameFilter';
import type { GameWithLiked } from './game-filter-helpers';

vi.mock('../../constants/game-colors', () => ({
    getGameColors: () => ({ bg: '#000', border: '#111', icon: 'X' }),
}));

function makeGame(slug: string, name: string, liked: boolean): GameWithLiked {
    return { slug, name, coverUrl: null, liked };
}

describe('SectionedGameList — edge cases', () => {
    it('renders nothing when games array is empty', () => {
        const { container } = render(
            <SectionedGameList
                games={[]}
                selectedGames={new Set()}
                toggleGame={vi.fn()}
            />,
        );

        expect(container.innerHTML).toBe('');
    });

    it('calls toggleGame with the correct slug when a game is toggled', async () => {
        const user = userEvent.setup();
        const toggleGame = vi.fn();
        const games = [makeGame('wow', 'World of Warcraft', false)];

        render(
            <SectionedGameList
                games={games}
                selectedGames={new Set()}
                toggleGame={toggleGame}
            />,
        );

        const checkbox = screen.getByRole('checkbox');
        await user.click(checkbox);
        expect(toggleGame).toHaveBeenCalledWith('wow');
    });

    it('renders checkboxes as checked for selected games and unchecked for unselected', () => {
        const games = [
            makeGame('wow', 'World of Warcraft', false),
            makeGame('eso', 'Elder Scrolls Online', false),
        ];

        render(
            <SectionedGameList
                games={games}
                selectedGames={new Set(['wow'])}
                toggleGame={vi.fn()}
            />,
        );

        const checkboxes = screen.getAllByRole('checkbox');
        // Find which checkbox is for which game
        const wowCheckbox = checkboxes.find(
            (cb) => cb.closest('label')?.textContent?.includes('World of Warcraft'),
        );
        const esoCheckbox = checkboxes.find(
            (cb) => cb.closest('label')?.textContent?.includes('Elder Scrolls Online'),
        );

        expect(wowCheckbox).toBeChecked();
        expect(esoCheckbox).not.toBeChecked();
    });

    it('shows "Your Games" header but no "Other Games" when only liked games exist', () => {
        const games = [
            makeGame('wow', 'World of Warcraft', true),
        ];

        render(
            <SectionedGameList
                games={games}
                selectedGames={new Set(['wow'])}
                toggleGame={vi.fn()}
            />,
        );

        expect(screen.getByText('Your Games')).toBeInTheDocument();
        expect(screen.queryByText('Other Games')).not.toBeInTheDocument();
    });

    it('renders games in the order provided (liked first, then other)', () => {
        const games = [
            makeGame('wow', 'World of Warcraft', true),
            makeGame('ffxiv', 'Final Fantasy XIV', true),
            makeGame('eso', 'Elder Scrolls Online', false),
            makeGame('gw2', 'Guild Wars 2', false),
        ];

        render(
            <SectionedGameList
                games={games}
                selectedGames={new Set(['wow', 'ffxiv', 'eso', 'gw2'])}
                toggleGame={vi.fn()}
            />,
        );

        const gameNames = screen.getAllByRole('checkbox').map(
            (cb) => cb.closest('label')?.querySelector('.game-filter-name')?.textContent ?? '',
        );

        // Liked section first, then other section
        expect(gameNames).toEqual([
            'World of Warcraft',
            'Final Fantasy XIV',
            'Elder Scrolls Online',
            'Guild Wars 2',
        ]);
    });

    it('handles many games without errors', () => {
        const games: GameWithLiked[] = [];
        for (let i = 0; i < 100; i++) {
            games.push(makeGame(`game-${i}`, `Game ${i}`, i < 20));
        }

        const { container } = render(
            <SectionedGameList
                games={games}
                selectedGames={new Set(games.map((g) => g.slug))}
                toggleGame={vi.fn()}
            />,
        );

        const checkboxes = container.querySelectorAll('input[type="checkbox"]');
        expect(checkboxes).toHaveLength(100);
    });

    it('toggleGame is called once per click, not multiple times', async () => {
        const user = userEvent.setup();
        const toggleGame = vi.fn();
        const games = [
            makeGame('wow', 'World of Warcraft', true),
            makeGame('eso', 'Elder Scrolls Online', false),
        ];

        render(
            <SectionedGameList
                games={games}
                selectedGames={new Set(['wow', 'eso'])}
                toggleGame={toggleGame}
            />,
        );

        const checkboxes = screen.getAllByRole('checkbox');
        await user.click(checkboxes[0]);

        expect(toggleGame).toHaveBeenCalledTimes(1);
    });
});

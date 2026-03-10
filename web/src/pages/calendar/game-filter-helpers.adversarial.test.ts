import { describe, it, expect } from 'vitest';
import { sortGamesWithLikedFirst } from './game-filter-helpers';
import type { GameInfo } from '../../stores/game-filter-store';

function makeGame(slug: string, name: string): GameInfo {
    return { slug, name, coverUrl: null };
}

describe('sortGamesWithLikedFirst — edge cases', () => {
    it('does not mutate the original games array', () => {
        const games = [makeGame('b', 'Beta'), makeGame('a', 'Alpha')];
        const original = [...games];
        sortGamesWithLikedFirst(games, new Set(['a']));
        expect(games).toEqual(original);
    });

    it('handles likedSlugs containing slugs not present in games', () => {
        const games = [makeGame('wow', 'World of Warcraft')];
        const result = sortGamesWithLikedFirst(games, new Set(['nonexistent', 'also-missing']));
        expect(result).toHaveLength(1);
        expect(result[0].liked).toBe(false);
        expect(result[0].slug).toBe('wow');
    });

    it('handles a single game that is liked', () => {
        const games = [makeGame('wow', 'World of Warcraft')];
        const result = sortGamesWithLikedFirst(games, new Set(['wow']));
        expect(result).toHaveLength(1);
        expect(result[0].liked).toBe(true);
    });

    it('handles a single game that is not liked', () => {
        const games = [makeGame('wow', 'World of Warcraft')];
        const result = sortGamesWithLikedFirst(games, new Set());
        expect(result).toHaveLength(1);
        expect(result[0].liked).toBe(false);
    });

    it('slug matching is case-sensitive', () => {
        const games = [makeGame('WoW', 'World of Warcraft')];
        const result = sortGamesWithLikedFirst(games, new Set(['wow']));
        expect(result[0].liked).toBe(false);
    });

    it('handles games with identical names in different sections', () => {
        const games = [
            makeGame('custom-dnd', 'D&D'),
            makeGame('official-dnd', 'D&D'),
        ];
        const result = sortGamesWithLikedFirst(games, new Set(['custom-dnd']));
        expect(result[0].liked).toBe(true);
        expect(result[0].slug).toBe('custom-dnd');
        expect(result[1].liked).toBe(false);
        expect(result[1].slug).toBe('official-dnd');
    });

    it('preserves coverUrl in output', () => {
        const games: GameInfo[] = [
            { slug: 'wow', name: 'WoW', coverUrl: 'https://example.com/wow.jpg' },
            { slug: 'eso', name: 'ESO', coverUrl: null },
        ];
        const result = sortGamesWithLikedFirst(games, new Set(['eso']));
        expect(result[0].coverUrl).toBeNull(); // eso (liked, first)
        expect(result[1].coverUrl).toBe('https://example.com/wow.jpg');
    });

    it('handles large number of games with mixed liked status', () => {
        const games: GameInfo[] = [];
        const likedSlugs = new Set<string>();
        for (let i = 0; i < 50; i++) {
            const slug = `game-${String(i).padStart(3, '0')}`;
            games.push(makeGame(slug, `Game ${String(i).padStart(3, '0')}`));
            if (i % 3 === 0) likedSlugs.add(slug);
        }

        const result = sortGamesWithLikedFirst(games, likedSlugs);

        // All liked games come before all non-liked games
        const firstUnlikedIdx = result.findIndex((g) => !g.liked);
        const lastLikedIdx = result.findLastIndex((g) => g.liked);
        if (firstUnlikedIdx !== -1 && lastLikedIdx !== -1) {
            expect(lastLikedIdx).toBeLessThan(firstUnlikedIdx);
        }

        // Within each section, names are alphabetical
        const likedNames = result.filter((g) => g.liked).map((g) => g.name);
        const otherNames = result.filter((g) => !g.liked).map((g) => g.name);
        expect(likedNames).toEqual([...likedNames].sort());
        expect(otherNames).toEqual([...otherNames].sort());
    });

    it('uses locale-aware sorting for names with special characters', () => {
        const games = [
            makeGame('a', 'Zeta'),
            makeGame('b', 'alpha'),
            makeGame('c', 'Beta'),
        ];
        const result = sortGamesWithLikedFirst(games, new Set());
        // localeCompare typically sorts case-insensitively
        const names = result.map((g) => g.name);
        const expected = [...names].sort((a, b) => a.localeCompare(b));
        expect(names).toEqual(expected);
    });
});

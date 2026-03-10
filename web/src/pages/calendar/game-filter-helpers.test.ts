import { describe, it, expect } from 'vitest';
import { sortGamesWithLikedFirst, type GameWithLiked } from './game-filter-helpers';

describe('sortGamesWithLikedFirst', () => {
    const makeGame = (slug: string, name: string): GameWithLiked => ({
        slug, name, coverUrl: null, liked: false,
    });

    it('returns empty array when given no games', () => {
        expect(sortGamesWithLikedFirst([], new Set())).toEqual([]);
    });

    it('marks games as liked when slug is in likedSlugs set', () => {
        const games = [makeGame('wow', 'World of Warcraft')];
        const result = sortGamesWithLikedFirst(games, new Set(['wow']));
        expect(result[0].liked).toBe(true);
    });

    it('marks games as not liked when slug is not in likedSlugs set', () => {
        const games = [makeGame('wow', 'World of Warcraft')];
        const result = sortGamesWithLikedFirst(games, new Set());
        expect(result[0].liked).toBe(false);
    });

    it('sorts liked games before other games', () => {
        const games = [
            makeGame('eso', 'Elder Scrolls Online'),
            makeGame('wow', 'World of Warcraft'),
            makeGame('ffxiv', 'Final Fantasy XIV'),
        ];
        const result = sortGamesWithLikedFirst(games, new Set(['wow']));
        expect(result[0].slug).toBe('wow');
        expect(result[0].liked).toBe(true);
        expect(result[1].liked).toBe(false);
        expect(result[2].liked).toBe(false);
    });

    it('sorts liked games alphabetically within their section', () => {
        const games = [
            makeGame('eso', 'Elder Scrolls Online'),
            makeGame('wow', 'World of Warcraft'),
            makeGame('ffxiv', 'Final Fantasy XIV'),
        ];
        const result = sortGamesWithLikedFirst(games, new Set(['wow', 'ffxiv']));
        expect(result[0].slug).toBe('ffxiv');
        expect(result[1].slug).toBe('wow');
    });

    it('sorts other games alphabetically within their section', () => {
        const games = [
            makeGame('wow', 'World of Warcraft'),
            makeGame('eso', 'Elder Scrolls Online'),
            makeGame('ffxiv', 'Final Fantasy XIV'),
        ];
        const result = sortGamesWithLikedFirst(games, new Set(['wow']));
        expect(result[1].slug).toBe('eso');
        expect(result[2].slug).toBe('ffxiv');
    });

    it('returns all games when no liked slugs provided', () => {
        const games = [
            makeGame('wow', 'World of Warcraft'),
            makeGame('eso', 'Elder Scrolls Online'),
        ];
        const result = sortGamesWithLikedFirst(games, new Set());
        expect(result).toHaveLength(2);
        expect(result.every((g) => !g.liked)).toBe(true);
    });

    it('returns all games as liked when all slugs are in likedSlugs', () => {
        const games = [
            makeGame('wow', 'World of Warcraft'),
            makeGame('eso', 'Elder Scrolls Online'),
        ];
        const result = sortGamesWithLikedFirst(games, new Set(['wow', 'eso']));
        expect(result.every((g) => g.liked)).toBe(true);
    });
});

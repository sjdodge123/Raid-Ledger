import { describe, it, expect } from 'vitest';
import {
    buildGenreOptions,
    filterEventsByGenre,
    type GenreOption,
} from './genre-filter-helpers';
import type { EventResponseDto, GameRegistryDto } from '@raid-ledger/contract';
import { createMockEvent } from '../../test/factories';

/** Helper to build a minimal GameRegistryDto */
function makeGame(
    overrides: Partial<GameRegistryDto> & { id: number; name: string },
): GameRegistryDto {
    return {
        slug: overrides.name.toLowerCase().replace(/\s+/g, '-'),
        shortName: null,
        coverUrl: null,
        colorHex: null,
        hasRoles: false,
        hasSpecs: false,
        enabled: true,
        maxCharactersPerUser: 10,
        genres: [],
        ...overrides,
    };
}

const TEST_GAMES: GameRegistryDto[] = [
    makeGame({ id: 1, name: 'WoW', genres: [12] }),
    makeGame({ id: 2, name: 'Fortnite', genres: [5] }),
    makeGame({ id: 3, name: 'Generic', genres: [] }),
];

const TEST_EVENTS: EventResponseDto[] = [
    createMockEvent({ id: 1, title: 'WoW Raid', game: { id: 1, name: 'WoW', slug: 'wow', coverUrl: null } }),
    createMockEvent({ id: 2, title: 'Fortnite Match', game: { id: 2, name: 'Fortnite', slug: 'fortnite', coverUrl: null } }),
    createMockEvent({ id: 3, title: 'Generic Event', game: { id: 3, name: 'Generic', slug: 'generic', coverUrl: null } }),
];

describe('buildGenreOptions', () => {
    it('returns empty array when no games have genres', () => {
        const games = [makeGame({ id: 1, name: 'Generic', genres: [] })];
        expect(buildGenreOptions(games)).toEqual([]);
    });

    it('returns unique genre options for games with genres', () => {
        const games = [
            makeGame({ id: 1, name: 'WoW', genres: [12] }),
            makeGame({ id: 2, name: 'FFXIV', genres: [12] }),
            makeGame({ id: 3, name: 'Fortnite', genres: [5] }),
        ];
        const keys = buildGenreOptions(games).map((o: GenreOption) => o.key);
        expect(keys).toContain('rpg');
        expect(keys).toContain('shooter');
    });

    it('sorts options alphabetically by label', () => {
        const games = [
            makeGame({ id: 1, name: 'Game1', genres: [15] }),
            makeGame({ id: 2, name: 'Game2', genres: [12] }),
            makeGame({ id: 3, name: 'Game3', genres: [5] }),
        ];
        const labels = buildGenreOptions(games).map((o: GenreOption) => o.label);
        expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
    });

    it('does not include genres that no game matches', () => {
        const games = [makeGame({ id: 1, name: 'WoW', genres: [12] })];
        const keys = buildGenreOptions(games).map((o: GenreOption) => o.key);
        expect(keys).not.toContain('shooter');
        expect(keys).not.toContain('moba');
    });
});

describe('filterEventsByGenre — passthrough', () => {
    it('returns all events when genreKey is undefined', () => {
        expect(filterEventsByGenre(TEST_EVENTS, TEST_GAMES, undefined)).toHaveLength(3);
    });

    it('returns all events when genreKey is empty string', () => {
        expect(filterEventsByGenre(TEST_EVENTS, TEST_GAMES, '')).toHaveLength(3);
    });
});

describe('filterEventsByGenre — filtering', () => {
    it('filters to only RPG games when genreKey is "rpg"', () => {
        const result = filterEventsByGenre(TEST_EVENTS, TEST_GAMES, 'rpg');
        expect(result).toHaveLength(1);
        expect(result[0].title).toBe('WoW Raid');
    });

    it('filters to only Shooter games when genreKey is "shooter"', () => {
        const result = filterEventsByGenre(TEST_EVENTS, TEST_GAMES, 'shooter');
        expect(result).toHaveLength(1);
        expect(result[0].title).toBe('Fortnite Match');
    });

    it('returns empty array when no events match genre', () => {
        expect(filterEventsByGenre(TEST_EVENTS, TEST_GAMES, 'moba')).toHaveLength(0);
    });

    it('handles events with null game', () => {
        const eventsWithNull = [
            ...TEST_EVENTS,
            createMockEvent({ id: 4, title: 'No Game', game: null }),
        ];
        const result = filterEventsByGenre(eventsWithNull, TEST_GAMES, 'rpg');
        expect(result).toHaveLength(1);
        expect(result[0].title).toBe('WoW Raid');
    });

    it('handles events whose game is not in registry', () => {
        const eventsWithUnknown = [
            ...TEST_EVENTS,
            createMockEvent({
                id: 5,
                title: 'Unknown Game Event',
                game: { id: 999, name: 'Unknown', slug: 'unknown', coverUrl: null },
            }),
        ];
        expect(filterEventsByGenre(eventsWithUnknown, TEST_GAMES, 'rpg')).toHaveLength(1);
    });
});

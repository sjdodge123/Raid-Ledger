/**
 * ROK-1525 slice 1 — library filter predicate logic (player count + ownership).
 *
 * TDD: written BEFORE the implementation. The module under test does not exist
 * yet, so this file fails-by-construction until
 * `web/src/pages/games/library-filter.helpers.ts` exists with the exports below.
 *
 * Operator rulings (2026-09-12) encoded here:
 *   - preset chips are 2 / 3 / 4 / 5+ and live in ONE exported const;
 *   - "supports N" means N falls INSIDE the game's IGDB min-max range, so a
 *     4-player-minimum game is not an answer to "the two of us";
 *   - `5+` is open-ended: `max >= 5`, with no upper bound to straddle;
 *   - `N own` means owned by AT LEAST N members.
 *
 * NULL rulings (the two traps this suite exists to pin):
 *   - `playerCount == null` is EXCLUDED while a player chip is active. It is
 *     never guessed at and never falls back to `cooptimusOnlineMax` — that is
 *     the ROK-1402 co-op field and counts co-op support, not lobby size.
 *   - `ownerCount == null` is a stale DTO that omitted the aggregate, i.e.
 *     UNKNOWN. It is excluded while an owners chip is active, never read as 0.
 */
import { describe, it, expect } from 'vitest';
import {
    PLAYER_COUNT_PRESETS,
    applyLibraryFilters,
    countActiveLibraryFilters,
    hasActiveLibraryFilters,
    isPlayerPresetKey,
    type LibraryFilterableGame,
} from './library-filter.helpers';

/** Minimal row factory — every field is optional on the structural input. */
function game(
    name: string,
    over: Partial<LibraryFilterableGame> = {},
): LibraryFilterableGame & { name: string } {
    return { name, playerCount: null, ownerCount: null, ...over };
}

const players = (min: number, max: number) => ({ playerCount: { min, max } });

describe('PLAYER_COUNT_PRESETS', () => {
    it('is the single source of truth for the 2/3/4/5+ chips', () => {
        expect(PLAYER_COUNT_PRESETS.map((p) => p.key)).toEqual(['2', '3', '4', '5plus']);
        expect(PLAYER_COUNT_PRESETS.map((p) => p.label)).toEqual(['2', '3', '4', '5+']);
        expect(isPlayerPresetKey('5plus')).toBe(true);
        expect(isPlayerPresetKey('6')).toBe(false);
        expect(isPlayerPresetKey(undefined)).toBe(false);
    });
});

describe('supports-N player predicate', () => {
    it('keeps a game whose range straddles N and drops one whose max is below N', () => {
        const straddles = game('Deep Rock', players(1, 4));
        const tooSmall = game('Portal 2', players(1, 2));

        const kept = applyLibraryFilters([straddles, tooSmall], { players: '4' });

        expect(kept.map((g) => g.name)).toEqual(['Deep Rock']);
    });

    it('drops a game whose min is above N (a 4-player-minimum game is not a 2-player answer)', () => {
        const fourPlayerMinimum = game('Four Only', players(4, 4));
        const twoUp = game('Two Up', players(2, 8));

        const kept = applyLibraryFilters([fourPlayerMinimum, twoUp], { players: '2' });

        expect(kept.map((g) => g.name)).toEqual(['Two Up']);
    });

    it('treats the 5+ preset as max >= 5, keeping a 1-24 game and dropping a 1-4 game', () => {
        const big = game('Ark', players(1, 24));
        const exactlyFive = game('Five Cap', players(2, 5));
        const four = game('Quad', players(1, 4));

        const kept = applyLibraryFilters([big, exactlyFive, four], { players: '5plus' });

        expect(kept.map((g) => g.name)).toEqual(['Ark', 'Five Cap']);
    });

    it('drops a null playerCount while the chip is active and keeps it when inactive', () => {
        // The structural input deliberately carries no co-op field, so a
        // Co-Optimus answer cannot rescue a missing IGDB range even by accident.
        const unknown = game('No IGDB Range', { playerCount: null });
        const known = game('Known', players(1, 4));

        expect(applyLibraryFilters([unknown, known], { players: '4' }).map((g) => g.name)).toEqual([
            'Known',
        ]);
        expect(applyLibraryFilters([unknown, known], {}).map((g) => g.name)).toEqual([
            'No IGDB Range',
            'Known',
        ]);
    });
});

describe('owned-by-at-least-N predicate', () => {
    it('keeps ownerCount >= N, drops below N, and drops a null (unknown) ownerCount', () => {
        const four = game('Four Own', { ownerCount: 4 });
        const exactly = game('Two Own', { ownerCount: 2 });
        const one = game('One Own', { ownerCount: 1 });
        const zero = game('Nobody', { ownerCount: 0 });
        const stale = game('Stale DTO', { ownerCount: null });

        const kept = applyLibraryFilters([four, exactly, one, zero, stale], { minOwners: 2 });

        expect(kept.map((g) => g.name)).toEqual(['Four Own', 'Two Own']);
    });
});

describe('applyLibraryFilters', () => {
    const rows = [
        game('A', { ...players(1, 4), ownerCount: 5 }),
        game('B', { ...players(1, 2), ownerCount: 5 }),
        game('C', { ...players(2, 8), ownerCount: 1 }),
        game('D', { ...players(1, 4), ownerCount: 3 }),
    ];

    it('returns every row in original order when no predicate is active', () => {
        expect(countActiveLibraryFilters({})).toBe(0);
        expect(hasActiveLibraryFilters({})).toBe(false);

        const kept = applyLibraryFilters(rows, {});

        expect(kept.map((g) => g.name)).toEqual(['A', 'B', 'C', 'D']);
        expect(kept).not.toBe(rows);
        expect(rows.map((g) => g.name)).toEqual(['A', 'B', 'C', 'D']);
    });

    it('ANDs both predicates and returns only the intersection, order preserved', () => {
        const state = { players: '4' as const, minOwners: 3 };

        expect(countActiveLibraryFilters(state)).toBe(2);
        expect(hasActiveLibraryFilters(state)).toBe(true);
        expect(applyLibraryFilters(rows, state).map((g) => g.name)).toEqual(['A', 'D']);
    });
});

/**
 * ROK-1402 — co-op filter predicate logic (games library FilterPanel).
 *
 * TDD: written BEFORE the implementation. The module under test does not exist
 * yet, so this file fails-by-construction until the dev creates
 * `web/src/pages/games/coop-filter.helpers.ts` with the exports below.
 *
 * PRESCRIBED PUBLIC API (spec `planning-artifacts/specs/ROK-1402.md`):
 *
 *   export interface CoopFilterState {
 *       onlineMinPlayers?: number;   // undefined / 0 / NaN => inactive
 *       couchCoop?: boolean;
 *       lanCoop?: boolean;
 *       splitscreen?: boolean;
 *       campaignCoop?: boolean;
 *   }
 *   export const EMPTY_COOP_FILTERS: CoopFilterState;
 *   export function effectiveOnlineMax(game: CoopFilterableGame): number | null;
 *   export function countActiveCoopFilters(state: CoopFilterState): number;
 *   export function hasActiveCoopFilters(state: CoopFilterState): boolean;
 *   export function applyCoopFilters<T extends CoopFilterableGame>(
 *       games: readonly T[], state: CoopFilterState,
 *   ): T[];
 *
 * `CoopFilterableGame` MUST be a structural `Pick`-style shape (playerCount +
 * the `cooptimus*` fields, all nullable/optional), NOT the full `GameDetailDto`
 * — callers pass discover rows, search rows, and stale Redis rows whose co-op
 * fields may be entirely absent.
 *
 * Strict semantics (operator, 2026-08-20): effective online max is
 * `cooptimusOnlineMax` and nothing else — 0 included, null included, with NO
 * IGDB `playerCount.max` fallback (a lobby size is not co-op support). A game
 * Co-Optimus has not answered for is EXCLUDED whenever any co-op predicate is
 * active.
 *
 * The Co-Optimus HTTP user-agent is deliberately never referenced here.
 */
import { describe, it, expect } from 'vitest';
import {
    applyCoopFilters,
    countActiveCoopFilters,
    effectiveOnlineMax,
    hasActiveCoopFilters,
    EMPTY_COOP_FILTERS,
    type CoopFilterState,
} from './coop-filter.helpers';

/** Minimal row shape the predicates read — mirrors the list DTO fields. */
interface GameLike {
    id: number;
    name: string;
    playerCount?: { min: number; max: number } | null;
    cooptimusOnlineMax?: number | null;
    cooptimusCouchMax?: number | null;
    cooptimusLanMax?: number | null;
    cooptimusSplitscreen?: boolean | null;
    cooptimusCampaignCoop?: boolean | null;
}

/** Fully-null co-op row (never synced) with no IGDB player count. */
function game(id: number, name: string, over: Partial<GameLike> = {}): GameLike {
    return {
        id,
        name,
        playerCount: null,
        cooptimusOnlineMax: null,
        cooptimusCouchMax: null,
        cooptimusLanMax: null,
        cooptimusSplitscreen: null,
        cooptimusCampaignCoop: null,
        ...over,
    };
}

/** Ids surviving the filter, for compact assertions. */
function ids(rows: GameLike[]): number[] {
    return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// effectiveOnlineMax — the precedence rule
// ---------------------------------------------------------------------------

describe('ROK-1402 — effectiveOnlineMax precedence', () => {
    it('returns the Co-Optimus online max', () => {
        const g = game(1, 'Deep Rock', {
            cooptimusOnlineMax: 4,
            playerCount: { min: 1, max: 64 },
        });
        expect(effectiveOnlineMax(g)).toBe(4);
    });

    it('returns null when cooptimusOnlineMax is null, IGDB player count or not', () => {
        // Strict semantics: an IGDB lobby size counts players, not co-op
        // support, so it must never stand in for a missing Co-Optimus answer.
        const g = game(2, 'Battlefield', {
            cooptimusOnlineMax: null,
            playerCount: { min: 2, max: 8 },
        });
        expect(effectiveOnlineMax(g)).toBeNull();
    });

    it('returns 0 for a synced game with no online co-op, ignoring a big IGDB lobby', () => {
        // A PvP-only title (100-player IGDB lobby, zero online co-op) must fail
        // every "N+ online" predicate once enrichment has run.
        const g = game(3, 'Pvp Only', {
            cooptimusOnlineMax: 0,
            playerCount: { min: 1, max: 100 },
        });
        expect(effectiveOnlineMax(g)).toBe(0);
    });

    it('returns 0 when cooptimusOnlineMax is 0 and there is no IGDB player count', () => {
        const g = game(4, 'Single Player Only', {
            cooptimusOnlineMax: 0,
            playerCount: null,
        });
        expect(effectiveOnlineMax(g)).toBe(0);
    });

    it('returns null when Co-Optimus has no answer (never synced, no IGDB data)', () => {
        expect(effectiveOnlineMax(game(5, 'Unknown'))).toBeNull();
    });

    it('treats undefined co-op fields (stale Redis row) as null, IGDB data notwithstanding', () => {
        const stale = { id: 6, name: 'Stale', playerCount: { min: 1, max: 6 } } as GameLike;
        expect(effectiveOnlineMax(stale)).toBeNull();
    });

    it('returns null for a stale row with no co-op fields and no playerCount at all', () => {
        const stale = { id: 7, name: 'Very Stale' } as GameLike;
        expect(effectiveOnlineMax(stale)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// countActiveCoopFilters / hasActiveCoopFilters
// ---------------------------------------------------------------------------

describe('ROK-1402 — active filter counting', () => {
    it('EMPTY_COOP_FILTERS has no active filters', () => {
        expect(countActiveCoopFilters(EMPTY_COOP_FILTERS)).toBe(0);
        expect(hasActiveCoopFilters(EMPTY_COOP_FILTERS)).toBe(false);
    });

    it('does not count onlineMinPlayers of 0 or undefined', () => {
        expect(countActiveCoopFilters({ onlineMinPlayers: 0 })).toBe(0);
        expect(countActiveCoopFilters({ onlineMinPlayers: undefined })).toBe(0);
    });

    it('counts onlineMinPlayers of 1 or more', () => {
        expect(countActiveCoopFilters({ onlineMinPlayers: 1 })).toBe(1);
        expect(countActiveCoopFilters({ onlineMinPlayers: 4 })).toBe(1);
    });

    it('counts each boolean toggle that is true, ignoring false and undefined', () => {
        expect(countActiveCoopFilters({ couchCoop: true })).toBe(1);
        expect(countActiveCoopFilters({ couchCoop: false })).toBe(0);
        expect(
            countActiveCoopFilters({
                couchCoop: true,
                lanCoop: true,
                splitscreen: true,
                campaignCoop: true,
            }),
        ).toBe(4);
    });

    it('sums numeric and boolean filters together', () => {
        const state: CoopFilterState = { onlineMinPlayers: 4, splitscreen: true, lanCoop: false };
        expect(countActiveCoopFilters(state)).toBe(2);
        expect(hasActiveCoopFilters(state)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// applyCoopFilters — numeric predicate
// ---------------------------------------------------------------------------

describe('ROK-1402 — applyCoopFilters numeric predicate', () => {
    const rows: GameLike[] = [
        game(1, 'Four Online', { cooptimusOnlineMax: 4 }),
        game(2, 'Two Online', { cooptimusOnlineMax: 2 }),
        game(3, 'Igdb Eight', { playerCount: { min: 1, max: 8 } }),
        game(4, 'No Data'),
    ];

    it('is inactive when onlineMinPlayers is undefined — every row survives, null-data included', () => {
        expect(ids(applyCoopFilters(rows, {}))).toEqual([1, 2, 3, 4]);
    });

    it('is inactive when onlineMinPlayers is 0 (cleared input) — not "N >= 0"', () => {
        expect(ids(applyCoopFilters(rows, { onlineMinPlayers: 0 }))).toEqual([1, 2, 3, 4]);
    });

    it('is inactive when onlineMinPlayers is NaN (invalid input)', () => {
        expect(ids(applyCoopFilters(rows, { onlineMinPlayers: Number.NaN }))).toEqual([1, 2, 3, 4]);
    });

    it('keeps only rows whose Co-Optimus online max is >= N', () => {
        // Row 3 has an IGDB max of 8 and no Co-Optimus answer — strict
        // semantics drop it rather than crediting the IGDB lobby size.
        expect(ids(applyCoopFilters(rows, { onlineMinPlayers: 4 }))).toEqual([1]);
    });

    it('never matches a game that only has an IGDB player count', () => {
        const igdbOnly = [game(11, 'Igdb Only', { playerCount: { min: 1, max: 64 } })];
        expect(applyCoopFilters(igdbOnly, { onlineMinPlayers: 2 })).toHaveLength(0);
    });

    it('excludes rows with no co-op data when the numeric predicate is active', () => {
        expect(ids(applyCoopFilters(rows, { onlineMinPlayers: 1 }))).not.toContain(4);
    });

    it('drops a cooptimusOnlineMax of 0 even when IGDB reports a big lobby', () => {
        const zeroWithIgdb = [game(9, 'Zero Coop Hundred Igdb', {
            cooptimusOnlineMax: 0,
            playerCount: { min: 1, max: 100 },
        })];
        expect(applyCoopFilters(zeroWithIgdb, { onlineMinPlayers: 4 })).toHaveLength(0);
    });

    it('excludes a cooptimusOnlineMax of 0', () => {
        const zeroNoIgdb = [game(10, 'Zero Coop No Igdb', { cooptimusOnlineMax: 0 })];
        expect(applyCoopFilters(zeroNoIgdb, { onlineMinPlayers: 1 })).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// applyCoopFilters — boolean predicates
// ---------------------------------------------------------------------------

describe('ROK-1402 — applyCoopFilters boolean predicates', () => {
    it('couchCoop keeps rows with a couch max of 2+ and drops solo/none/null', () => {
        const rows = [
            game(1, 'Couch Four', { cooptimusCouchMax: 4 }),
            game(2, 'Couch Two', { cooptimusCouchMax: 2 }),
            game(3, 'Couch One', { cooptimusCouchMax: 1 }),
            game(4, 'Couch Zero', { cooptimusCouchMax: 0 }),
            game(5, 'Couch Null'),
        ];
        expect(ids(applyCoopFilters(rows, { couchCoop: true }))).toEqual([1, 2]);
    });

    it('lanCoop keeps rows with a LAN max of 2+ and drops the rest', () => {
        const rows = [
            game(1, 'Lan Four', { cooptimusLanMax: 4 }),
            game(2, 'Lan Zero', { cooptimusLanMax: 0 }),
            game(3, 'Lan Null'),
        ];
        expect(ids(applyCoopFilters(rows, { lanCoop: true }))).toEqual([1]);
    });

    it('splitscreen keeps flag === true only; false (synced) and null (unsynced) both drop', () => {
        const rows = [
            game(1, 'Split Yes', { cooptimusSplitscreen: true }),
            game(2, 'Split No', { cooptimusSplitscreen: false }),
            game(3, 'Split Null', { cooptimusSplitscreen: null }),
            { id: 4, name: 'Split Absent' } as GameLike,
        ];
        expect(ids(applyCoopFilters(rows, { splitscreen: true }))).toEqual([1]);
    });

    it('campaignCoop keeps flag === true only', () => {
        const rows = [
            game(1, 'Campaign Yes', { cooptimusCampaignCoop: true }),
            game(2, 'Campaign No', { cooptimusCampaignCoop: false }),
            game(3, 'Campaign Null'),
        ];
        expect(ids(applyCoopFilters(rows, { campaignCoop: true }))).toEqual([1]);
    });

    it('a toggle set to false is inactive and filters nothing', () => {
        const rows = [
            game(1, 'Split Yes', { cooptimusSplitscreen: true }),
            game(2, 'Split Null'),
        ];
        expect(ids(applyCoopFilters(rows, { splitscreen: false }))).toEqual([1, 2]);
    });
});

// ---------------------------------------------------------------------------
// applyCoopFilters — composition, immutability, stale-shape safety
// ---------------------------------------------------------------------------

describe('ROK-1402 — applyCoopFilters composition and safety', () => {
    const rows: GameLike[] = [
        game(1, 'All The Coop', {
            cooptimusOnlineMax: 4,
            cooptimusCouchMax: 2,
            cooptimusSplitscreen: true,
            cooptimusCampaignCoop: true,
        }),
        game(2, 'Online Only', { cooptimusOnlineMax: 4, cooptimusSplitscreen: false }),
        game(3, 'Splitscreen Only', { cooptimusSplitscreen: true }),
        game(4, 'No Data'),
    ];

    it('intersects the numeric predicate with a boolean predicate', () => {
        expect(ids(applyCoopFilters(rows, { onlineMinPlayers: 4, splitscreen: true }))).toEqual([1]);
    });

    it('intersects multiple boolean predicates', () => {
        expect(ids(applyCoopFilters(rows, { splitscreen: true, campaignCoop: true }))).toEqual([1]);
    });

    it('returns an empty array when nothing satisfies every active predicate', () => {
        expect(applyCoopFilters(rows, { onlineMinPlayers: 64, splitscreen: true })).toHaveLength(0);
    });

    it('does not throw on stale rows whose co-op fields are entirely absent', () => {
        const stale = [{ id: 8, name: 'Stale Redis Row' }] as GameLike[];
        expect(() => applyCoopFilters(stale, { onlineMinPlayers: 2 })).not.toThrow();
        expect(() => applyCoopFilters(stale, { couchCoop: true })).not.toThrow();
        expect(() => applyCoopFilters(stale, { splitscreen: true })).not.toThrow();
    });

    it('excludes stale rows with absent co-op fields when any predicate is active', () => {
        const stale = [{ id: 8, name: 'Stale Redis Row' }] as GameLike[];
        expect(applyCoopFilters(stale, { onlineMinPlayers: 2 })).toHaveLength(0);
        expect(applyCoopFilters(stale, { splitscreen: true })).toHaveLength(0);
    });

    it('preserves input order and does not mutate the source array', () => {
        const source = [...rows];
        const result = applyCoopFilters(source, { onlineMinPlayers: 4 });
        expect(ids(result)).toEqual([1, 2]);
        expect(ids(source)).toEqual([1, 2, 3, 4]);
    });

    it('returns the same rows (by identity) it was given when no filter is active', () => {
        const result = applyCoopFilters(rows, EMPTY_COOP_FILTERS);
        expect(result).toHaveLength(rows.length);
        expect(result[0]).toBe(rows[0]);
    });
});

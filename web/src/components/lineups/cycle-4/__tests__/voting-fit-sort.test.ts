/**
 * Failing-first tests for the "fits our group" sort assist helpers
 * (ROK-1401 §2e — the one item the shipping batch deferred).
 *
 * Source file does not yet exist — these MUST fail with module-not-found
 * until `web/src/components/lineups/cycle-4/voting-fit-sort.ts` is created.
 *
 * The rules under test are the SAME two-rule split the shipped ROK-1401
 * surfaces already honor:
 *   - A co-op fit CLAIM is Co-Optimus-verified ONLY. `cooptimusOnlineMax`
 *     is the single source; `0`, `null` and `undefined` are all "no claim",
 *     and IGDB `playerCount` is NEVER consulted (a lobby size is not a
 *     co-op capability).
 *   - The assist is advisory: it re-orders, it never filters or hides.
 *     Every entry that goes in comes out.
 */
import { describe, it, expect } from 'vitest';
import type { LineupEntryResponseDto } from '@raid-ledger/contract';
import {
    coopFitsGroup,
    anyCoopFitData,
    sortForLeaderboard,
} from '../voting-fit-sort';

function makeEntry(
    overrides: Partial<LineupEntryResponseDto> = {},
): LineupEntryResponseDto {
    return {
        id: 1,
        gameId: 42,
        gameName: 'Valheim',
        gameCoverUrl: null,
        nominatedBy: { id: 1, displayName: 'Admin' },
        note: null,
        carriedOver: false,
        voteCount: 1,
        createdAt: '2026-05-15T00:00:00.000Z',
        ownerCount: 8,
        totalMembers: 12,
        nonOwnerCount: 4,
        wishlistCount: 0,
        itadCurrentPrice: null,
        itadCurrentCut: null,
        itadCurrentShop: null,
        itadCurrentUrl: null,
        playerCount: null,
        ...overrides,
    };
}

// ─────────────────────────────────────────────────────────────────────
// coopFitsGroup — Co-Optimus-verified only, positive only
// ─────────────────────────────────────────────────────────────────────

describe('coopFitsGroup — the fit predicate', () => {
    it('fits when the online co-op max covers the whole group', () => {
        expect(coopFitsGroup(makeEntry({ cooptimusOnlineMax: 6 }), 6)).toBe(
            true,
        );
        expect(coopFitsGroup(makeEntry({ cooptimusOnlineMax: 8 }), 6)).toBe(
            true,
        );
    });

    it('does not fit when the online co-op max is under the group size', () => {
        expect(coopFitsGroup(makeEntry({ cooptimusOnlineMax: 4 }), 6)).toBe(
            false,
        );
    });

    it('treats 0 (synced, no online co-op) as no claim', () => {
        expect(coopFitsGroup(makeEntry({ cooptimusOnlineMax: 0 }), 1)).toBe(
            false,
        );
    });

    it('treats null and undefined (never synced) as no claim', () => {
        expect(coopFitsGroup(makeEntry({ cooptimusOnlineMax: null }), 1)).toBe(
            false,
        );
        expect(coopFitsGroup(makeEntry({}), 1)).toBe(false);
    });

    it('NEVER falls back to IGDB playerCount for a co-op claim', () => {
        // PUBG-shaped: a 100-player lobby is not 100-player co-op.
        const lobbyOnly = makeEntry({
            cooptimusOnlineMax: null,
            playerCount: { min: 1, max: 100 },
        });
        expect(coopFitsGroup(lobbyOnly, 6)).toBe(false);
    });

    it('cannot evaluate fit against a non-positive group size', () => {
        expect(coopFitsGroup(makeEntry({ cooptimusOnlineMax: 6 }), 0)).toBe(
            false,
        );
        expect(coopFitsGroup(makeEntry({ cooptimusOnlineMax: 6 }), -1)).toBe(
            false,
        );
    });
});

// ─────────────────────────────────────────────────────────────────────
// anyCoopFitData — the dormancy gate
// ─────────────────────────────────────────────────────────────────────

describe('anyCoopFitData — gates the control on real data', () => {
    it('is false for an un-synced library (the pre-activation default)', () => {
        expect(
            anyCoopFitData([
                makeEntry({ id: 1, cooptimusOnlineMax: null }),
                makeEntry({ id: 2 }),
                makeEntry({ id: 3, cooptimusOnlineMax: 0 }),
            ]),
        ).toBe(false);
    });

    it('is true as soon as ONE entry carries a positive online max', () => {
        expect(
            anyCoopFitData([
                makeEntry({ id: 1, cooptimusOnlineMax: null }),
                makeEntry({ id: 2, cooptimusOnlineMax: 4 }),
            ]),
        ).toBe(true);
    });

    it('is false for an empty leaderboard', () => {
        expect(anyCoopFitData([])).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────
// sortForLeaderboard — vote order preserved inside each group
// ─────────────────────────────────────────────────────────────────────

describe('sortForLeaderboard', () => {
    const entries = [
        makeEntry({ id: 1, voteCount: 5, ownerCount: 1, cooptimusOnlineMax: 2 }),
        makeEntry({ id: 2, voteCount: 3, ownerCount: 1, cooptimusOnlineMax: 8 }),
        makeEntry({ id: 3, voteCount: 9, ownerCount: 1, cooptimusOnlineMax: null }),
        makeEntry({ id: 4, voteCount: 3, ownerCount: 7, cooptimusOnlineMax: 6 }),
    ];

    it('sorts by voteCount desc with ownerCount desc as tiebreaker when off', () => {
        const ids = sortForLeaderboard(entries, {
            fitsFirst: false,
            groupSize: 6,
        }).map((e) => e.id);
        expect(ids).toEqual([3, 1, 4, 2]);
    });

    it('floats fitting entries above the rest when on', () => {
        const ids = sortForLeaderboard(entries, {
            fitsFirst: true,
            groupSize: 6,
        }).map((e) => e.id);
        // Fitting (>= 6): ids 2 and 4 — kept in vote order (4 before 2 on
        // the ownerCount tiebreaker). Non-fitting: 3 then 1, also in vote
        // order. The assist re-ranks BETWEEN groups, never WITHIN one.
        expect(ids).toEqual([4, 2, 3, 1]);
    });

    it('never drops or duplicates an entry', () => {
        const out = sortForLeaderboard(entries, {
            fitsFirst: true,
            groupSize: 6,
        });
        expect(out).toHaveLength(entries.length);
        expect([...out.map((e) => e.id)].sort()).toEqual([1, 2, 3, 4]);
    });

    it('does not mutate the caller array', () => {
        const input = [...entries];
        sortForLeaderboard(input, { fitsFirst: true, groupSize: 6 });
        expect(input.map((e) => e.id)).toEqual([1, 2, 3, 4]);
    });

    it('is a no-op re-rank when nothing fits', () => {
        const ids = sortForLeaderboard(entries, {
            fitsFirst: true,
            groupSize: 99,
        }).map((e) => e.id);
        expect(ids).toEqual([3, 1, 4, 2]);
    });
});

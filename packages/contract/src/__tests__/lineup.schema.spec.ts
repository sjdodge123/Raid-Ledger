/**
 * Failing-first contract tests for ROK-1297 (S1 Nominating composite +
 * Common Ground multi-row hero).
 *
 * Validates the additive `theme` + `whyReason` fields the dev will add to
 * `CommonGroundGameSchema` / `CommonGroundResponseSchema`, and the new
 * `CommonGroundThemeSchema` enum. These tests MUST fail with import or
 * parser errors until the dev ships the schema extension.
 *
 * Path follows the spec at `docs/specs/rok-1297-s1-nominating-composite.md`
 * §Test plan. The contract package has no test runner of its own today —
 * the test agent's TDD report documents this gap (see
 * `planning-artifacts/tdd-report-ROK-1297.md`). The same coverage is
 * mirrored in `api/src/lineups/lineup-schema-theme.spec.ts` (picked up by
 * `npm run test -w api`) so a runner exercises the assertions.
 */
import { describe, it, expect } from 'vitest';
import {
    CommonGroundGameSchema,
    CommonGroundResponseSchema,
    CommonGroundThemeSchema,
    type CommonGroundGameDto,
    type CommonGroundTheme,
} from '../lineup.schema.js';

/** Minimal valid CommonGroundGame payload before the ROK-1297 additions. */
function baseGame(): CommonGroundGameDto {
    return {
        gameId: 1,
        gameName: 'Valheim',
        slug: 'valheim',
        coverUrl: null,
        ownerCount: 4,
        wishlistCount: 0,
        nonOwnerPrice: null,
        itadCurrentCut: null,
        itadCurrentShop: null,
        itadCurrentUrl: null,
        earlyAccess: false,
        itadTags: [],
        playerCount: null,
        score: 40,
    };
}

describe('CommonGroundThemeSchema (ROK-1297)', () => {
    it('accepts the three legal theme values', () => {
        const themes: CommonGroundTheme[] = ['owned', 'taste', 'trending'];
        for (const theme of themes) {
            expect(() => CommonGroundThemeSchema.parse(theme)).not.toThrow();
        }
    });

    it('rejects an unknown theme string', () => {
        expect(() => CommonGroundThemeSchema.parse('hot')).toThrow();
        expect(() => CommonGroundThemeSchema.parse('OWNED')).toThrow();
        expect(() => CommonGroundThemeSchema.parse('')).toThrow();
    });
});

describe('CommonGroundGameSchema — theme + whyReason additive fields (ROK-1297)', () => {
    it('accepts a game with theme=undefined and whyReason=undefined (legacy fallback)', () => {
        const parsed = CommonGroundGameSchema.parse(baseGame());
        expect(parsed.theme).toBeUndefined();
        expect(parsed.whyReason).toBeUndefined();
    });

    it('accepts a game with both theme and whyReason set', () => {
        const game = {
            ...baseGame(),
            theme: 'owned' as const,
            whyReason: '12 of you own this',
        };
        const parsed = CommonGroundGameSchema.parse(game);
        expect(parsed.theme).toBe('owned');
        expect(parsed.whyReason).toBe('12 of you own this');
    });

    it('rejects a whyReason longer than 80 characters', () => {
        const game = {
            ...baseGame(),
            theme: 'taste' as const,
            whyReason: 'x'.repeat(81),
        };
        expect(() => CommonGroundGameSchema.parse(game)).toThrow();
    });

    it('accepts a whyReason of exactly 80 characters', () => {
        const game = {
            ...baseGame(),
            theme: 'trending' as const,
            whyReason: 'y'.repeat(80),
        };
        const parsed = CommonGroundGameSchema.parse(game);
        expect(parsed.whyReason).toHaveLength(80);
    });

    it('rejects an unknown theme value at the game level', () => {
        const game = { ...baseGame(), theme: 'mystery' };
        expect(() => CommonGroundGameSchema.parse(game)).toThrow();
    });
});

describe('CommonGroundResponseSchema accepts the extended game shape (ROK-1297)', () => {
    it('parses a response whose data items carry theme + whyReason', () => {
        const response = {
            data: [
                {
                    ...baseGame(),
                    theme: 'owned' as const,
                    whyReason: '5 of you own this',
                },
                {
                    ...baseGame(),
                    gameId: 2,
                    slug: 'subnautica',
                    theme: 'taste' as const,
                    whyReason: 'Matches your sci-fi/co-op cluster',
                },
            ],
            meta: {
                total: 2,
                appliedWeights: {
                    ownerWeight: 1,
                    saleBonus: 0,
                    fullPricePenalty: 0,
                    tasteWeight: 0,
                    socialWeight: 0,
                    intensityWeight: 0,
                },
                activeLineupId: 7,
                nominatedCount: 0,
                maxNominations: 20,
                participantCount: 5,
            },
        };
        const parsed = CommonGroundResponseSchema.parse(response);
        expect(parsed.data[0].theme).toBe('owned');
        expect(parsed.data[1].theme).toBe('taste');
    });
});

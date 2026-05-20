/**
 * Failing-first contract tests for ROK-1297 (S1 Nominating composite +
 * Common Ground multi-row hero) and ROK-1298 (Sv Voting composite +
 * normalized vote bars + a11y vote toggle).
 *
 * Validates additive schema fields:
 *   - ROK-1297: `theme` + `whyReason` on `CommonGroundGameSchema`, and the
 *     new `CommonGroundThemeSchema` enum.
 *   - ROK-1298: `votingEligibleCount` on `LineupDetailResponseSchema`.
 *
 * The contract package has no test runner of its own — these specs are
 * also exercised by api-side mirrors so jest picks them up under
 * `npm run test -w api`.
 */
import { describe, it, expect } from 'vitest';
import {
    CommonGroundGameSchema,
    CommonGroundResponseSchema,
    CommonGroundThemeSchema,
    LineupDetailResponseSchema,
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

/** Minimal valid LineupDetailResponse payload (status='voting'). */
function baseLineup(): Record<string, unknown> {
    return {
        id: 1,
        title: 'Test Lineup',
        description: null,
        status: 'voting',
        targetDate: null,
        decidedGameId: null,
        decidedGameName: null,
        linkedEventId: null,
        createdBy: { id: 1, displayName: 'Admin' },
        votingDeadline: null,
        phaseDeadline: null,
        pendingAdvanceAt: null,
        autoAdvancePausedAt: null,
        matchThreshold: 35,
        maxVotesPerPlayer: 3,
        defaultTiebreakerMode: null,
        entries: [],
        totalVoters: 0,
        totalMembers: 12,
        myVotes: [],
        unlinkedSteamCount: 0,
        unlinkedSteamMembers: [],
        createdAt: '2026-05-15T00:00:00.000Z',
        updatedAt: '2026-05-15T00:00:00.000Z',
        tiebreaker: null,
        channelOverrideId: null,
        channelOverrideName: null,
        visibility: 'public',
        invitees: [],
        stillWaitingOnVoters: [],
        publicShareEnabled: true,
        publicSlug: 'test-lineup',
        viewerSubmissions: {
            nominationsSubmittedAt: null,
            votesSubmittedAt: null,
        },
    };
}

describe('LineupDetailResponseSchema — votingEligibleCount additive field (ROK-1298)', () => {
    it('accepts a positive integer for votingEligibleCount', () => {
        const lineup = { ...baseLineup(), votingEligibleCount: 12 };
        const parsed = LineupDetailResponseSchema.parse(lineup);
        expect(parsed.votingEligibleCount).toBe(12);
    });

    it('accepts a small positive integer (creator-only private lineup)', () => {
        const lineup = { ...baseLineup(), votingEligibleCount: 1 };
        const parsed = LineupDetailResponseSchema.parse(lineup);
        expect(parsed.votingEligibleCount).toBe(1);
    });

    it('accepts a large positive integer (public lineup with many members)', () => {
        const lineup = { ...baseLineup(), votingEligibleCount: 250 };
        const parsed = LineupDetailResponseSchema.parse(lineup);
        expect(parsed.votingEligibleCount).toBe(250);
    });

    it('rejects votingEligibleCount=0 (creator is always eligible — guard)', () => {
        const lineup = { ...baseLineup(), votingEligibleCount: 0 };
        expect(() => LineupDetailResponseSchema.parse(lineup)).toThrow();
    });

    it('rejects a negative votingEligibleCount', () => {
        const lineup = { ...baseLineup(), votingEligibleCount: -5 };
        expect(() => LineupDetailResponseSchema.parse(lineup)).toThrow();
    });

    it('rejects a non-integer votingEligibleCount', () => {
        const lineup = { ...baseLineup(), votingEligibleCount: 3.5 };
        expect(() => LineupDetailResponseSchema.parse(lineup)).toThrow();
    });

    it('rejects a missing votingEligibleCount (field is required)', () => {
        const lineup = baseLineup();
        // No votingEligibleCount key at all — must fail once the schema
        // makes it required.
        expect(() => LineupDetailResponseSchema.parse(lineup)).toThrow();
    });

    it('rejects a non-numeric votingEligibleCount', () => {
        const lineup = { ...baseLineup(), votingEligibleCount: '12' };
        expect(() => LineupDetailResponseSchema.parse(lineup)).toThrow();
    });
});

/**
 * ROK-1453 — factories for the LFG read DTOs.
 *
 * `gameSlug` is the field this story ADDS to `LfgGroupSummarySchema` and
 * `LfgHeartedGameSchema` (spec decision D2). Until that lands the published
 * contract types do not carry it, so the factories widen the DTO locally
 * rather than dropping the field — the tests are written against the target
 * contract, not the current one. Once D2 ships, `WithGameSlug<T>` collapses to
 * `T` and can be deleted; the factory return types stay valid either way.
 */
import type {
    LfgGroupSummaryDto,
    LfgHeartedGameDto,
} from '@raid-ledger/contract';

/**
 * `POST /lfg` response. Spelled out in full because the web client parses
 * write responses with `LfgIntentResponseSchema` — a short fixture fails
 * validation, the mutation never reaches `onSuccess`, and any assertion about
 * invalidation silently passes for the wrong reason.
 */
export function buildLfgIntentResponse(gameId = 1) {
    return {
        id: 1,
        userId: 9,
        gameId,
        status: 'active' as const,
        visibility: 'local' as const,
        createdAt: '2026-09-02T00:00:00.000Z',
        expiresAt: '2026-09-09T00:00:00.000Z',
        convertedToPollId: null,
        convertedToEventId: null,
        group: buildLfgGroupSummary({ gameId, hasOwnIntent: true }),
    };
}

/** Target-contract widening — see the note above. */
export type WithGameSlug<T> = T & { gameSlug: string };

export type LfgGroupSummaryFixture = WithGameSlug<LfgGroupSummaryDto>;
export type LfgHeartedGameFixture = WithGameSlug<LfgHeartedGameDto>;

/**
 * A single-player group ('lfg') by default — the state that needs the
 * "needs N more" half of the chip copy.
 */
export function buildLfgGroupSummary(
    overrides: Partial<LfgGroupSummaryFixture> = {},
): LfgGroupSummaryFixture {
    return {
        gameId: 1,
        gameName: 'Deep Rock Galactic',
        gameSlug: 'deep-rock-galactic',
        gameCoverUrl: null,
        activeCount: 1,
        state: 'lfg',
        viabilityThreshold: null,
        isViable: false,
        hasOwnIntent: false,
        soonestExpiresAt: '2026-09-15T00:00:00.000Z',
        ...overrides,
    };
}

/** Convenience: the 2+ ('lfm') variant most tile assertions use. */
export function buildLfmGroupSummary(
    overrides: Partial<LfgGroupSummaryFixture> = {},
): LfgGroupSummaryFixture {
    return buildLfgGroupSummary({
        activeCount: 2,
        state: 'lfm',
        ...overrides,
    });
}

export function buildLfgHeartedGame(
    overrides: Partial<LfgHeartedGameFixture> = {},
): LfgHeartedGameFixture {
    return {
        gameId: 1,
        gameName: 'Deep Rock Galactic',
        gameSlug: 'deep-rock-galactic',
        gameCoverUrl: null,
        heartedAt: '2026-09-01T00:00:00.000Z',
        activeCount: 0,
        ...overrides,
    };
}

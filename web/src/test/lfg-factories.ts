/**
 * Test factories for the LFG DTOs (ROK-1451 intents + ROK-1463 group reads).
 * Shared by the group-page component tests and the MSW handlers.
 */
import type {
    LfgGroupDetailDto,
    LfgHistoryEntryDto,
    LfgIntentDto,
    LfgMemberDto,
    LfgOverlapResponseDto,
    LfgOverlapWindowDto,
    LfgSuggestionDto,
} from '@raid-ledger/contract';

const NOW = '2026-09-02T18:00:00.000Z';
const SOON = '2026-09-03T18:00:00.000Z';

/** A visible member of an LFG/LFM roster. */
export function createMockLfgMember(
    over: Partial<LfgMemberDto> = {},
): LfgMemberDto {
    return {
        userId: 1,
        username: 'ana',
        displayName: 'Ana',
        avatarUrl: null,
        expiresAt: SOON,
        joinedAt: NOW,
        ...over,
    };
}

/** The caller's own active intent row. */
export function createMockLfgIntent(
    over: Partial<LfgIntentDto> = {},
): LfgIntentDto {
    return {
        id: 10,
        userId: 1,
        gameId: 7,
        status: 'active',
        visibility: 'local',
        createdAt: NOW,
        expiresAt: SOON,
        convertedToPollId: null,
        convertedToEventId: null,
        ...over,
    };
}

/** `GET /lfg/:gameId`. Defaults to a one-person group with no viability data. */
export function createMockLfgGroupDetail(
    over: Partial<LfgGroupDetailDto> = {},
): LfgGroupDetailDto {
    return {
        gameId: 7,
        gameName: 'Deep Rock Galactic',
        // ROK-1453 added `gameSlug` to the summary schema the detail extends.
        gameSlug: 'deep-rock-galactic',
        gameCoverUrl: null,
        activeCount: 1,
        state: 'lfg',
        viabilityThreshold: null,
        isViable: false,
        hasOwnIntent: false,
        soonestExpiresAt: SOON,
        members: [createMockLfgMember()],
        ownIntent: null,
        ...over,
    };
}

/** One contiguous window the roster could play in. */
export function createMockOverlapWindow(
    over: Partial<LfgOverlapWindowDto> = {},
): LfgOverlapWindowDto {
    return {
        start: new Date(2026, 8, 2, 19).toISOString(),
        end: new Date(2026, 8, 2, 22).toISOString(),
        availableCount: 2,
        totalCount: 2,
        members: [1, 2],
        ...over,
    };
}

/** `GET /lfg/:gameId/overlap`. */
export function createMockOverlapResponse(
    over: Partial<LfgOverlapResponseDto> = {},
): LfgOverlapResponseDto {
    return {
        gameId: 7,
        memberCount: 2,
        horizonDays: 14,
        windows: [createMockOverlapWindow()],
        ...over,
    };
}

/** One past session for `GET /lfg/:gameId/history`. */
export function createMockHistoryEntry(
    over: Partial<LfgHistoryEntryDto> = {},
): LfgHistoryEntryDto {
    return {
        eventId: 100,
        title: 'Friday deep dive',
        isAdHoc: false,
        startedAt: '2026-08-21T19:00:00.000Z',
        endedAt: '2026-08-21T21:40:00.000Z',
        durationMinutes: 160,
        attendedCount: 3,
        signedUpCount: 4,
        participantIds: [1, 2, 3],
        ...over,
    };
}

/** One row of `GET /lfg/:gameId/suggestions`. */
export function createMockSuggestion(
    over: Partial<LfgSuggestionDto> = {},
): LfgSuggestionDto {
    return {
        userId: 2,
        username: 'bo',
        displayName: 'Bo',
        avatarUrl: null,
        reasons: ['played'],
        lastPlayedAt: '2026-08-21T21:40:00.000Z',
        ...over,
    };
}

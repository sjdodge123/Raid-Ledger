import type { SeriesNightDto, SeriesSignupDto, SeriesSignupStateDto } from '@raid-ledger/contract';

const HOUR = 60 * 60 * 1000;

/** A night `hoursAhead` from now. */
export function night(eventId: number, hoursAhead: number, state: SeriesNightDto['state'], signupStatus: SeriesNightDto['signupStatus'] = null): SeriesNightDto {
    return { eventId, startTime: new Date(Date.now() + hoursAhead * HOUR).toISOString(), state, signupStatus };
}

export function activeMembership(): SeriesSignupDto {
    return {
        id: 7, recurrenceGroupId: '11111111-1111-4111-8111-111111111111', userId: 1, characterId: null, preferredRoles: null,
        status: 'active', endedReason: null, joinedAt: '2026-11-01T00:00:00.000Z', endedAt: null,
    };
}

/** A series state; `joinableCount` and the span follow the will_* nights unless overridden. */
export function seriesState(nights: SeriesNightDto[], overrides: Partial<SeriesSignupStateDto> = {}): SeriesSignupStateDto {
    const joinable = nights.filter((n) => n.state === 'will_create' || n.state === 'will_attach');
    return {
        membership: null, nights, joinableCount: joinable.length,
        firstNight: joinable[0]?.startTime ?? null, lastNight: joinable[joinable.length - 1]?.startTime ?? null,
        ...overrides,
    };
}

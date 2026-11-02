import type { EventResponseDto, SeriesLeaveNightDto, SeriesNightDto, SeriesSignupStateDto } from '@raid-ledger/contract';

/** Hours before a night under which a cancel counts as late — the api's `GRACEFUL_DECLINE_HOURS`. */
export const LATE_CANCEL_HOURS = 23;

/** "Oct 21" — the short night label the series copy uses. */
export function formatNightDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** True when the viewer holds an active series membership. */
export function isSeriesMember(state: SeriesSignupStateDto | undefined): boolean {
    return state?.membership?.status === 'active';
}

/** This night's entry in the series state (`nights` holds only future, non-cancelled nights). */
export function nightFor(state: SeriesSignupStateDto, eventId: number): SeriesNightDto | undefined {
    return state.nights.find((n) => n.eventId === eventId);
}

/** The nights the membership currently signs the viewer up for. */
export function memberNights(state: SeriesSignupStateDto): SeriesNightDto[] {
    return state.nights.filter((n) => n.state === 'in_series');
}

/** Every night Leave cancels — from now, not just from this page (falls back to `memberNights`). */
export function leaveNights(state: SeriesSignupStateDto): readonly SeriesLeaveNightDto[] {
    return state.leaveNights ?? memberNights(state);
}

/** Nights the viewer already declined; a join leaves them as they are. */
export function keptNightCount(state: SeriesSignupStateDto): number {
    return state.nights.filter((n) => n.state === 'stays_inactive').length;
}

/** The first member night that starts in under 23h — leaving now makes it a late cancel. */
export function lateCancelNight<T extends Pick<SeriesNightDto, 'startTime'>>(nights: readonly T[], now: number = Date.now()): T | undefined {
    const limit = now + LATE_CANCEL_HOURS * 60 * 60 * 1000;
    return nights.find((n) => new Date(n.startTime).getTime() < limit);
}

/** "6 nights" / "1 night". */
export function nightsLabel(count: number): string {
    return `${count} ${count === 1 ? 'night' : 'nights'}`;
}

/** True when this night belongs to a live series, so its series state is worth fetching. */
export function isSeriesJoinCandidate(event: Pick<EventResponseDto, 'recurrenceGroupId' | 'cancelledAt'>): boolean {
    return !!event.recurrenceGroupId && !event.cancelledAt;
}

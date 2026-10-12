/**
 * MSW handlers + fixtures for the calendar side of Game Time (ROK-1595):
 * synced away days (S1, `source:'calendar'` absences + Ignore) and the busy
 * band (S2, `calendarBusy`).
 *
 * Only the Ignore route is registered globally (`absenceIgnoreHandler`, a
 * harmless 204). The list and composite fixtures change what other game-time
 * specs render, so specs opt in with `server.use(...gameTimeCalendarHandlers())`.
 */
import { http, HttpResponse } from 'msw';
import type { GameTimeAbsence, GameTimeResponse } from '@raid-ledger/contract';
import { calendarErrorResponse } from './calendar-sync-handlers';

const API_BASE = 'http://localhost:3000';
export const GAME_TIME_URL = `${API_BASE}/users/me/game-time`;
export const GAME_TIME_ABSENCES_URL = `${API_BASE}/users/me/game-time/absences`;
export const ABSENCE_IGNORE_URL = `${API_BASE}/users/me/game-time/absences/:id/ignore`;

/** A manual absence: Remove, never Ignore. */
export const manualAbsenceFixture: GameTimeAbsence = {
    id: 11, startDate: '2026-10-20', endDate: '2026-10-21', reason: 'Trip', source: 'manual',
};

/** A synced all-day block from Google: Ignore, never Remove (spec finding 2). */
export const calendarAbsenceFixture: GameTimeAbsence = {
    id: 12, startDate: '2026-10-24', endDate: '2026-10-27', reason: null, source: 'calendar', provider: 'google',
};

/** Composite week with the S1/S2 calendar data the read UI renders. */
export function gameTimeWithCalendarFixture(over: Partial<GameTimeResponse> = {}): GameTimeResponse {
    return {
        slots: [{ dayOfWeek: 3, hour: 19, status: 'available' }],
        events: [],
        weekStart: '2026-10-11',
        absences: [calendarAbsenceFixture],
        calendarBusy: [{ dayOfWeek: 2, startHour: 18, endHour: 20, provider: 'google' }],
        ...over,
    };
}

/** Ignore → 204 (the server's success path). Registered globally. */
export const absenceIgnoreHandler = http.post(ABSENCE_IGNORE_URL, () => new HttpResponse(null, { status: 204 }));

/** Ignore error variants for `server.use()`. */
export const absenceIgnoreErrorHandlers = {
    /** A manual absence: 409 `not_calendar`. */
    notCalendar: () => http.post(ABSENCE_IGNORE_URL, () => calendarErrorResponse(409, 'not_calendar')),
    /** Missing, or another user's: 404. */
    notFound: () => http.post(ABSENCE_IGNORE_URL, () => calendarErrorResponse(404, 'Absence not found')),
};

/** Opt-in: absences list (manual + synced), the composite with calendar data, and Ignore 204. */
export function gameTimeCalendarHandlers(
    absences: GameTimeAbsence[] = [manualAbsenceFixture, calendarAbsenceFixture],
    composite: GameTimeResponse = gameTimeWithCalendarFixture(),
) {
    return [
        http.get(GAME_TIME_ABSENCES_URL, () => HttpResponse.json({ data: absences })),
        http.get(GAME_TIME_URL, () => HttpResponse.json({ data: composite })),
        absenceIgnoreHandler,
    ];
}

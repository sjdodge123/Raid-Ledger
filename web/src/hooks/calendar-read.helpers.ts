/**
 * Pure helpers behind the calendar read hooks (ROK-1595 L1): the error
 * classifier the read UI branches on, the optimistic overview patches (D3:
 * save immediately, revert on error) and the shared invalidation set.
 */
import type { QueryClient } from '@tanstack/react-query';
import type {
    CalendarConnection,
    CalendarReadMode,
    CalendarsOverview,
    UpdateCalendarConnection,
} from '@raid-ledger/contract';
import { errorBodyOf, httpStatusOf, withErrorBody, withHttpStatus } from '../lib/api/api-error';
import { CALENDARS_OVERVIEW_KEY } from './use-calendar-sync';
import { GAME_TIME_ABSENCES_KEY, GAME_TIME_QUERY_KEY } from './use-game-time';

/**
 * What a failed read call means for the UI. `read_scopes` → "Grant read
 * access" CTA; `throttled` → "Synced a moment ago"; `read_disabled` →
 * defensive toast; `not_found` → the connection is gone; anything else →
 * the generic "Could not save / load" copy.
 */
export type CalendarReadErrorKind = 'read_scopes' | 'read_disabled' | 'throttled' | 'not_found' | 'failed';

/** The server's code: Nest puts it in the body's `message` (fetchApi copies it to `.message`). */
function serverCodeOf(error: unknown): string | null {
    const message = errorBodyOf(error)?.['message'];
    if (typeof message === 'string') return message;
    return error instanceof Error ? error.message : null;
}

/** Classify a read-hook error; null when there is none. */
export function calendarReadErrorOf(error: unknown): CalendarReadErrorKind | null {
    if (error === null || error === undefined) return null;
    const status = httpStatusOf(error);
    const code = serverCodeOf(error);
    if (status === 429 || code === 'sync_throttled') return 'throttled';
    if (code === 'read_scopes') return 'read_scopes';
    if (code === 'read_disabled') return 'read_disabled';
    if (status === 404) return 'not_found';
    return 'failed';
}

/** The `read` part of `PATCH /users/me/calendars/:id`. */
export type ReadPatch = NonNullable<UpdateCalendarConnection['read']>;

function mergeRead(current: CalendarConnection['read'], patch: ReadPatch): CalendarConnection['read'] {
    return { enabled: patch.enabled ?? current.enabled, calendarIds: patch.calendarIds ?? current.calendarIds };
}

/** Apply a read PATCH to one connection in the overview. */
export function patchConnectionRead(overview: CalendarsOverview, id: number, patch: ReadPatch): CalendarsOverview {
    const connections = overview.connections.map((c) => (c.id === id ? { ...c, read: mergeRead(c.read, patch) } : c));
    return { ...overview, connections };
}

/** Apply a read-mode PUT to the overview. */
export function patchReadMode(overview: CalendarsOverview, mode: CalendarReadMode): CalendarsOverview {
    return { ...overview, readSettings: { ...overview.readSettings, mode } };
}

/** Mutation context: the overview as it was before the optimistic write. */
export interface OverviewSnapshot {
    previous: CalendarsOverview | undefined;
}

/** Rewrite the cached overview now; returns the snapshot `restoreOverview` puts back. */
export async function optimisticOverview(
    qc: QueryClient,
    patch: (overview: CalendarsOverview) => CalendarsOverview,
): Promise<OverviewSnapshot> {
    await qc.cancelQueries({ queryKey: [...CALENDARS_OVERVIEW_KEY] });
    const previous = qc.getQueryData<CalendarsOverview>([...CALENDARS_OVERVIEW_KEY]);
    if (previous) qc.setQueryData<CalendarsOverview>([...CALENDARS_OVERVIEW_KEY], patch(previous));
    return { previous };
}

export function restoreOverview(qc: QueryClient, snapshot: OverviewSnapshot | undefined): void {
    if (snapshot?.previous) qc.setQueryData<CalendarsOverview>([...CALENDARS_OVERVIEW_KEY], snapshot.previous);
}

/**
 * Everything a read-rule change can move: the overview (the switches), the
 * game-time composite (S2 busy band) and the absences list (S1 synced days),
 * plus scheduling polls, whose busy hours read the same sync (ROK-1593 PR-A).
 */
export function invalidateReadDependents(qc: QueryClient): Promise<unknown> {
    return Promise.all([
        qc.invalidateQueries({ queryKey: [...CALENDARS_OVERVIEW_KEY] }),
        qc.invalidateQueries({ queryKey: GAME_TIME_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: GAME_TIME_ABSENCES_KEY }),
        qc.invalidateQueries({ queryKey: ['scheduling'] }),
    ]);
}

/** `POST :id/sync` outcome: 202 queued, or 429 throttled (not an error: no retry loop). */
export type SyncNowResult = { outcome: 'queued' } | { outcome: 'throttled'; retryAfterSeconds: number | null };

/** `Retry-After` in seconds when the server sends one (it does not today); else null. */
export function retryAfterOf(res: Response): number | null {
    const raw = res.headers.get('Retry-After');
    if (raw === null || raw.trim() === '') return null;
    const seconds = Number(raw);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

/** Build the same error shape `fetchApi` throws (status + body attached) from a raw response. */
export async function responseError(res: Response): Promise<Error> {
    const body: unknown = await res.json().catch(() => null);
    const message = body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
        ? body.message
        : `HTTP ${res.status}`;
    return withErrorBody(withHttpStatus(new Error(message), res.status), body);
}

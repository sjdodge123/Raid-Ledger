/**
 * MSW handlers for the admin Calendar Sync settings (ROK-1591) and the
 * member Profile → Calendars endpoints (ROK-1594).
 *
 * Default: kill switch off, no client ids, no secrets. The PUT handler is
 * stateless — it answers with the default merged with the request body, the
 * same full shape the GET returns. Specs that need state across calls
 * override both routes with `server.use()`.
 */
import { http, HttpResponse } from 'msw';
import {
    AppleConnectInputSchema,
    UpdateAdminCalendarSyncSettingsSchema,
    UpdateCalendarConnectionSchema,
    UpdateCalendarReadSettingsSchema,
    type AdminCalendarSyncSettings,
    type CalendarConnection,
    type CalendarsOverview,
    type ProviderCalendar,
    type UpdateAdminCalendarSyncSettings,
} from '@raid-ledger/contract';
import { buildAppleConnection } from '../factories/calendar-sync';

const API_BASE = 'http://localhost:3000';
export const CALENDAR_SYNC_SETTINGS_URL = `${API_BASE}/admin/settings/calendar-sync`;

export const calendarSyncSettingsFixture: AdminCalendarSyncSettings = {
    enabled: false,
    google: { clientId: null, hasSecret: false },
    microsoft: { clientId: null, hasSecret: false },
    redirectUris: {
        google: 'http://localhost:5173/api/calendar-sync/oauth/google/callback',
        microsoft: 'http://localhost:5173/api/calendar-sync/oauth/microsoft/callback',
    },
};

type ProviderSettings = AdminCalendarSyncSettings['google'];
type ProviderUpdate = UpdateAdminCalendarSyncSettings['google'];

function mergeProvider(current: ProviderSettings, update: ProviderUpdate): ProviderSettings {
    if (!update) return current;
    const clientId = update.clientId === undefined ? current.clientId : update.clientId || null;
    const hasSecret = update.clientSecret === undefined ? current.hasSecret : update.clientSecret !== '';
    return { clientId, hasSecret };
}

/** Apply a PUT body to a settings object the way the server does. */
export function applyCalendarSyncUpdate(
    current: AdminCalendarSyncSettings,
    update: UpdateAdminCalendarSyncSettings,
): AdminCalendarSyncSettings {
    return {
        ...current,
        enabled: update.enabled ?? current.enabled,
        google: mergeProvider(current.google, update.google),
        microsoft: mergeProvider(current.microsoft, update.microsoft),
    };
}

/* ── Member endpoints: Profile → Calendars (ROK-1594) ─────────────────── */

export const CALENDARS_OVERVIEW_URL = `${API_BASE}/users/me/calendars`;
export const GOOGLE_OAUTH_START_URL = `${API_BASE}/users/me/calendars/oauth/google/start`;
export const CALENDAR_CONNECTION_URL = `${API_BASE}/users/me/calendars/:id`;
/** ROK-1599 subscribe link: POST creates or resets it, answering `{ url }`. */
export const CALENDAR_FEED_URL = `${API_BASE}/users/me/calendars/feed`;
export const CALENDAR_FEED_URL_FIXTURE = 'https://raid.example.test/api/cal/u/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.ics';
export const CALENDAR_FEED_RESET_URL_FIXTURE = 'https://raid.example.test/api/cal/u/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB.ics';
/** S3 event copy + Undo (ROK-1596 D9) and the one-event `.ics` (F10). */
export const EVENT_CALENDAR_COPY_URL = `${API_BASE}/users/me/calendars/events/:eventId`;
export const EVENT_CALENDAR_UNDO_URL = `${API_BASE}/users/me/calendars/events/:eventId/undo`;
export const EVENT_ICS_URL = `${API_BASE}/events/:id/ics`;
/** Read sync (ROK-1595): picker list, per-user read mode, manual sync. */
export const PROVIDER_CALENDARS_URL = `${API_BASE}/users/me/calendars/:id/calendars`;
export const CALENDAR_READ_SETTINGS_URL = `${API_BASE}/users/me/calendars/settings`;
export const CALENDAR_SYNC_NOW_URL = `${API_BASE}/users/me/calendars/:id/sync`;
/** Apple connect (ROK-1598 D10): app-specific password, 201 created / 200 reconnected. */
export const APPLE_CONNECT_URL = `${API_BASE}/users/me/calendars/apple`;
/** Passwords the Apple handler refuses: `…-fail` → 400 `apple_auth_failed`, `…-down` → 503 `apple_unavailable`. */
export const APPLE_PASSWORD_FAIL = 'xxxx-xxxx-xxxx-fail';
export const APPLE_PASSWORD_DOWN = 'xxxx-xxxx-xxxx-down';
export const GOOGLE_CONSENT_URL_FIXTURE = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=test-client';

/** A healthy Google connection, as `GET /users/me/calendars` lists it. */
export const calendarConnectionFixture: CalendarConnection = {
    id: 7,
    provider: 'google',
    accountLabel: 'raider@example.com',
    status: 'active',
    lastSyncedAt: null,
    errorCode: null,
    read: { enabled: false, calendarIds: [] },
    write: { enabled: false, target: 'dedicated' },
};

/** Default overview: switch on, Google available, no connections. */
export function calendarsOverviewFixture(over: Partial<CalendarsOverview> = {}): CalendarsOverview {
    return {
        enabled: true,
        providers: { google: { available: true }, microsoft: { available: false }, apple: { available: true } },
        connections: [],
        readSettings: { mode: 'both', lookAheadWeeks: 4 },
        feed: null,
        ...over,
    };
}

/** The page states the specs drive (+ `withFeed`, ROK-1599). */
export const calendarsOverviewVariants = {
    available: calendarsOverviewFixture(),
    connected: calendarsOverviewFixture({ connections: [calendarConnectionFixture] }),
    notConfigured: calendarsOverviewFixture({
        providers: { google: { available: false }, microsoft: { available: false }, apple: { available: false } },
    }),
    withApple: calendarsOverviewFixture({ connections: [buildAppleConnection()] }),
    withFeed: calendarsOverviewFixture({ feed: { url: CALENDAR_FEED_URL_FIXTURE } }),
    disabled: calendarsOverviewFixture({
        enabled: false,
        providers: { google: { available: false }, microsoft: { available: false }, apple: { available: false } },
    }),
} satisfies Record<string, CalendarsOverview>;

/** Overview answers with `overview`; start hands back the consent URL; DELETE → 202; PATCH echoes the merged connection. */
export function userCalendarHandlers(overview: CalendarsOverview = calendarsOverviewVariants.available) {
    return [
        http.get(CALENDARS_OVERVIEW_URL, () => HttpResponse.json(overview)),
        http.get(GOOGLE_OAUTH_START_URL, () => HttpResponse.json({ url: GOOGLE_CONSENT_URL_FIXTURE })),
        http.delete(CALENDAR_CONNECTION_URL, () => new HttpResponse(null, { status: 202 })),
        http.post(CALENDAR_FEED_URL, () => HttpResponse.json({ url: CALENDAR_FEED_RESET_URL_FIXTURE })),
        // Default: no write connection → no copy (null); Undo → 204; .ics → one VEVENT.
        http.get(EVENT_CALENDAR_COPY_URL, () => HttpResponse.json(null)),
        http.post(EVENT_CALENDAR_UNDO_URL, () => new HttpResponse(null, { status: 204 })),
        http.get(EVENT_ICS_URL, () => new HttpResponse('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', { headers: { 'Content-Type': 'text/calendar' } })),
        http.patch(CALENDAR_CONNECTION_URL, async ({ request }) => {
            const body = UpdateCalendarConnectionSchema.parse(await request.json());
            const write = { ...calendarConnectionFixture.write, ...body.write };
            const read = { ...calendarConnectionFixture.read, ...body.read };
            return HttpResponse.json({ ...calendarConnectionFixture, read, write });
        }),
        appleConnectHandler(),
        ...calendarReadHandlers(),
    ];
}

/** `POST …/apple`: bad body → 400 `invalid_input`; the two sentinel passwords refuse; else 201 + an Apple connection. */
export function appleConnectHandler() {
    return http.post(APPLE_CONNECT_URL, async ({ request }) => {
        const parsed = AppleConnectInputSchema.safeParse(await request.json());
        if (!parsed.success) {
            const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))];
            return HttpResponse.json({ code: 'invalid_input', fields }, { status: 400 });
        }
        const { email, appPassword } = parsed.data;
        if (appPassword === APPLE_PASSWORD_FAIL) return HttpResponse.json({ code: 'apple_auth_failed' }, { status: 400 });
        if (appPassword === APPLE_PASSWORD_DOWN) return HttpResponse.json({ code: 'apple_unavailable' }, { status: 503 });
        return HttpResponse.json(buildAppleConnection({ accountLabel: email.trim() }), { status: 201 });
    });
}

/** The route throttle (D13): Nest's throttler body, no `code`. */
export const appleConnectThrottledHandler = () => http.post(APPLE_CONNECT_URL, () => HttpResponse.json(
    { statusCode: 429, message: 'ThrottlerException: Too Many Requests' }, { status: 429 },
));

/* ── Read sync (ROK-1595) ─────────────────────────────────────────────── */

/** A read-granted Google connection with read on and the picker untouched (`[]` = primary). */
export const readConnectionFixture: CalendarConnection = {
    ...calendarConnectionFixture,
    lastSyncedAt: '2026-10-12T09:00:00.000Z',
    readAccess: 'granted',
    read: { enabled: true, calendarIds: [] },
};

/** The picker list: primary, a second calendar, and our dedicated one (the picker hides it). */
export const providerCalendarsFixture: ProviderCalendar[] = [
    { id: 'primary', name: 'raider@example.com', primary: true, writable: true, isRaidLedger: false },
    { id: 'work@group.calendar.google.com', name: 'Work', primary: false, writable: true, isRaidLedger: false },
    { id: 'rl@group.calendar.google.com', name: 'Raid Ledger', primary: false, writable: true, isRaidLedger: true },
];

/** Nest's error body: the machine code travels in `message`. */
export function calendarErrorResponse(status: number, code: string) {
    return HttpResponse.json({ statusCode: status, message: code, error: 'Error' }, { status });
}

/** Defaults: list → the fixture, PUT settings → 204, sync → 202. */
export function calendarReadHandlers(calendars: ProviderCalendar[] = providerCalendarsFixture) {
    return [
        http.get(PROVIDER_CALENDARS_URL, () => HttpResponse.json(calendars)),
        http.put(CALENDAR_READ_SETTINGS_URL, async ({ request }) => {
            UpdateCalendarReadSettingsSchema.parse(await request.json());
            return new HttpResponse(null, { status: 204 });
        }),
        http.post(CALENDAR_SYNC_NOW_URL, () => new HttpResponse(null, { status: 202 })),
    ];
}

/** Variants for `server.use()`: each answers one read route the way the server's error paths do. */
export const calendarReadErrorHandlers = {
    /** 429 within 5 min of the last sync; `retryAfterSeconds` adds a `Retry-After` header. */
    syncThrottled: (retryAfterSeconds?: number) => http.post(CALENDAR_SYNC_NOW_URL, () => HttpResponse.json(
        { statusCode: 429, message: 'sync_throttled' },
        { status: 429, ...(retryAfterSeconds === undefined ? {} : { headers: { 'Retry-After': String(retryAfterSeconds) } }) },
    )),
    syncConflict: (code: 'read_scopes' | 'read_disabled') => http.post(CALENDAR_SYNC_NOW_URL, () => calendarErrorResponse(409, code)),
    /** PATCH `read` on a connection without the read grant. */
    patchReadScopes: () => http.patch(CALENDAR_CONNECTION_URL, () => calendarErrorResponse(409, 'read_scopes')),
    patchFailed: () => http.patch(CALENDAR_CONNECTION_URL, () => calendarErrorResponse(500, 'Internal server error')),
    calendarsReadScopes: () => http.get(PROVIDER_CALENDARS_URL, () => calendarErrorResponse(409, 'read_scopes')),
    settingsFailed: () => http.put(CALENDAR_READ_SETTINGS_URL, () => calendarErrorResponse(500, 'Internal server error')),
};

export const calendarSyncHandlers = [
    http.get(CALENDAR_SYNC_SETTINGS_URL, () => HttpResponse.json(calendarSyncSettingsFixture)),
    http.put(CALENDAR_SYNC_SETTINGS_URL, async ({ request }) => {
        const body = UpdateAdminCalendarSyncSettingsSchema.parse(await request.json());
        return HttpResponse.json(applyCalendarSyncUpdate(calendarSyncSettingsFixture, body));
    }),
    ...userCalendarHandlers(),
];

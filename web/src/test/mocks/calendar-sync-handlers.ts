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
    UpdateAdminCalendarSyncSettingsSchema,
    type AdminCalendarSyncSettings,
    type CalendarConnection,
    type CalendarsOverview,
    type UpdateAdminCalendarSyncSettings,
} from '@raid-ledger/contract';

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
        providers: { google: { available: true }, microsoft: { available: false }, apple: { available: false } },
        connections: [],
        readSettings: { mode: 'both', lookAheadWeeks: 4 },
        feed: null,
        ...over,
    };
}

/** The four page states the specs drive. */
export const calendarsOverviewVariants = {
    available: calendarsOverviewFixture(),
    connected: calendarsOverviewFixture({ connections: [calendarConnectionFixture] }),
    notConfigured: calendarsOverviewFixture({
        providers: { google: { available: false }, microsoft: { available: false }, apple: { available: false } },
    }),
    disabled: calendarsOverviewFixture({
        enabled: false,
        providers: { google: { available: false }, microsoft: { available: false }, apple: { available: false } },
    }),
} satisfies Record<string, CalendarsOverview>;

/** Overview answers with `overview`; start hands back the consent URL; DELETE → 202. */
export function userCalendarHandlers(overview: CalendarsOverview = calendarsOverviewVariants.available) {
    return [
        http.get(CALENDARS_OVERVIEW_URL, () => HttpResponse.json(overview)),
        http.get(GOOGLE_OAUTH_START_URL, () => HttpResponse.json({ url: GOOGLE_CONSENT_URL_FIXTURE })),
        http.delete(CALENDAR_CONNECTION_URL, () => new HttpResponse(null, { status: 202 })),
    ];
}

export const calendarSyncHandlers = [
    http.get(CALENDAR_SYNC_SETTINGS_URL, () => HttpResponse.json(calendarSyncSettingsFixture)),
    http.put(CALENDAR_SYNC_SETTINGS_URL, async ({ request }) => {
        const body = UpdateAdminCalendarSyncSettingsSchema.parse(await request.json());
        return HttpResponse.json(applyCalendarSyncUpdate(calendarSyncSettingsFixture, body));
    }),
    ...userCalendarHandlers(),
];

/**
 * MSW handlers for the admin Calendar Sync settings (ROK-1591).
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

export const calendarSyncHandlers = [
    http.get(CALENDAR_SYNC_SETTINGS_URL, () => HttpResponse.json(calendarSyncSettingsFixture)),
    http.put(CALENDAR_SYNC_SETTINGS_URL, async ({ request }) => {
        const body = UpdateAdminCalendarSyncSettingsSchema.parse(await request.json());
        return HttpResponse.json(applyCalendarSyncUpdate(calendarSyncSettingsFixture, body));
    }),
];

/**
 * Admin Calendar Sync settings (ROK-1591): the kill switch plus the Google /
 * Microsoft OAuth client config. `GET/PUT /admin/settings/calendar-sync`.
 *
 * Responses are parsed with the contract schema, which is `.strict()` — a
 * server that ever leaked a `clientSecret` key fails the parse instead of
 * reaching the page.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    AdminCalendarSyncSettingsSchema,
    type AdminCalendarSyncSettings,
    type UpdateAdminCalendarSyncSettings,
} from '@raid-ledger/contract';
import { getAuthToken } from './use-auth';
import { adminFetch } from './admin/admin-fetch';

export const CALENDAR_SYNC_SETTINGS_KEY = ['admin', 'settings', 'calendar-sync'] as const;
const PATH = '/admin/settings/calendar-sync';

async function fetchCalendarSyncSettings(): Promise<AdminCalendarSyncSettings> {
    const raw = await adminFetch<unknown>(PATH, undefined, 'Failed to load Calendar Sync settings');
    return AdminCalendarSyncSettingsSchema.parse(raw);
}

function putCalendarSyncSettings(body: UpdateAdminCalendarSyncSettings): Promise<unknown> {
    return adminFetch<unknown>(PATH, {
        method: 'PUT', body: JSON.stringify(body),
    }, 'Failed to save Calendar Sync settings');
}

/** Query the admin Calendar Sync settings (kill switch, client ids, `hasSecret`, redirect URIs). */
export function useAdminCalendarSyncSettings() {
    return useQuery<AdminCalendarSyncSettings>({
        queryKey: [...CALENDAR_SYNC_SETTINGS_KEY],
        queryFn: fetchCalendarSyncSettings,
        enabled: !!getAuthToken(),
        staleTime: 30_000,
    });
}

/**
 * Save a partial update. Omitted field = unchanged, `''` = clear. When the
 * server answers with the full settings shape the cache takes it directly;
 * otherwise the query refetches.
 */
export function useUpdateAdminCalendarSyncSettings() {
    const queryClient = useQueryClient();
    return useMutation<unknown, Error, UpdateAdminCalendarSyncSettings>({
        mutationFn: putCalendarSyncSettings,
        onSuccess: (data) => {
            const parsed = AdminCalendarSyncSettingsSchema.safeParse(data);
            if (parsed.success) {
                queryClient.setQueryData([...CALENDAR_SYNC_SETTINGS_KEY], parsed.data);
                return;
            }
            void queryClient.invalidateQueries({ queryKey: [...CALENDAR_SYNC_SETTINGS_KEY] });
        },
    });
}

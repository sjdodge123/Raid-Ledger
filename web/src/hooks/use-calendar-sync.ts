/**
 * Member Calendar Sync hooks (ROK-1594): the Profile → Calendars overview,
 * the Google OAuth start, and disconnect.
 *
 * Responses parse with the contract schemas (`.strict()`), so a server that
 * ever leaked a credential key fails the parse instead of reaching the page.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    CalendarsOverviewSchema,
    OAuthStartResponseSchema,
    type CalendarsOverview,
} from '@raid-ledger/contract';
import { getAuthToken } from './use-auth';
import { fetchApi, fetchWithAuth } from '../lib/api/fetch-api';

export const CALENDARS_OVERVIEW_KEY = ['calendars', 'overview'] as const;
const BASE = '/users/me/calendars';

/** `GET /users/me/calendars` — kill switch, provider availability, connections. */
export function useCalendarsOverview() {
    return useQuery<CalendarsOverview>({
        queryKey: [...CALENDARS_OVERVIEW_KEY],
        queryFn: () => fetchApi(BASE, {}, CalendarsOverviewSchema),
        enabled: !!getAuthToken(),
        staleTime: 30_000,
        retry: false,
    });
}

/** True only once the overview loaded AND says the switch is on. */
export function useCalendarSyncEnabled(): boolean {
    const { data } = useCalendarsOverview();
    return data?.enabled === true;
}

/** Leaves the app for the provider's consent screen. */
function goToProvider(url: string): void {
    window.location.assign(url);
}

/** GET the signed Google consent URL, then send the browser there. */
export function useStartGoogleConnect() {
    return useMutation<string, Error, void>({
        mutationFn: async () => {
            const res = await fetchApi(`${BASE}/oauth/google/start`, {}, OAuthStartResponseSchema);
            return res.url;
        },
        onSuccess: goToProvider,
    });
}

/** `DELETE /users/me/calendars/:id` → 202 (empty body), then refetch the overview. */
export function useDisconnectCalendar() {
    const queryClient = useQueryClient();
    return useMutation<void, Error, number>({
        mutationFn: async (id) => {
            const res = await fetchWithAuth(`${BASE}/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: [...CALENDARS_OVERVIEW_KEY] });
            void queryClient.invalidateQueries({ queryKey: ['game-time'] });
        },
    });
}

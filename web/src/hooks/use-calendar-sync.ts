/**
 * Member Calendar Sync hooks (ROK-1594): the Profile → Calendars overview,
 * the Google OAuth start (with a consent `intent`, ROK-1596), the Apple
 * app-specific-password connect (ROK-1598), the write settings PATCH
 * (ROK-1596), disconnect, and one event's calendar copy + its Undo (ROK-1596 S3).
 *
 * Responses parse with the contract schemas (`.strict()`), so a server that
 * ever leaked a credential key fails the parse instead of reaching the page.
 */
import { useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    AppleConnectErrorSchema,
    CalendarConnectionSchema,
    CalendarsOverviewSchema,
    EventCalendarCopySchema,
    OAuthStartResponseSchema,
    type AppleConnectErrorCode,
    type AppleConnectInput,
    type CalendarConnection,
    type CalendarOAuthIntent,
    type CalendarsOverview,
    type EventCalendarCopy,
    type UpdateCalendarConnection,
} from '@raid-ledger/contract';
import { getAuthToken } from './use-auth';
import { fetchApi, fetchWithAuth } from '../lib/api/fetch-api';
import { GAME_TIME_ABSENCES_KEY, GAME_TIME_QUERY_KEY } from './use-game-time';

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

/**
 * GET the signed Google consent URL, then send the browser there.
 * `primary` asks for the extra `calendar.events` scope (ROK-1596 D8);
 * `connect` sends no query, which the server reads as `connect`.
 */
export function useStartOAuth(intent: CalendarOAuthIntent = 'connect') {
    return useMutation<string, Error, void>({
        mutationFn: async () => {
            const query = intent === 'connect' ? '' : `?intent=${intent}`;
            const res = await fetchApi(`${BASE}/oauth/google/start${query}`, {}, OAuthStartResponseSchema);
            return res.url;
        },
        onSuccess: goToProvider,
    });
}

/** K1 "Connect": the plain sign-in. */
export function useStartGoogleConnect() {
    return useStartOAuth('connect');
}

/** Why an Apple connect was refused: the server's code, the route throttle, or no answer at all. */
export type AppleConnectFailure = AppleConnectErrorCode | 'throttled' | 'network';

/** Rejection of {@link useConnectApple}; `failure` picks the inline copy. Never carries the input. */
export class AppleConnectRequestError extends Error {
    readonly failure: AppleConnectFailure;
    constructor(failure: AppleConnectFailure) {
        super(failure);
        this.name = 'AppleConnectRequestError';
        this.failure = failure;
    }
}

/** Map a refused `POST …/apple` to its failure: 429 is the throttle, else the parsed `{ code }`. */
export async function appleConnectFailureOf(res: Response): Promise<AppleConnectFailure> {
    if (res.status === 429) return 'throttled';
    const body: unknown = await res.json().catch(() => null);
    const parsed = AppleConnectErrorSchema.safeParse(body);
    if (parsed.success) return parsed.data.code;
    return res.status >= 500 ? 'apple_unavailable' : 'network';
}

async function postAppleConnect(input: AppleConnectInput): Promise<CalendarConnection> {
    let res: Response;
    try {
        res = await fetchWithAuth(`${BASE}/apple`, { method: 'POST', body: JSON.stringify(input) });
    } catch {
        throw new AppleConnectRequestError('network');
    }
    if (!res.ok) throw new AppleConnectRequestError(await appleConnectFailureOf(res));
    return CalendarConnectionSchema.parse(await res.json());
}

/**
 * `POST /users/me/calendars/apple` (ROK-1598 D10): 201 created / 200 reconnected.
 * `gcTime: 0` and the sheet's `reset()` on close/success keep the password out of
 * the mutation cache's `variables` once the request settles.
 */
export function useConnectApple() {
    const queryClient = useQueryClient();
    return useMutation<CalendarConnection, AppleConnectRequestError, AppleConnectInput>({
        mutationFn: postAppleConnect,
        gcTime: 0,
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: [...CALENDARS_OVERVIEW_KEY] });
            void queryClient.invalidateQueries({ queryKey: GAME_TIME_QUERY_KEY });
        },
    });
}

export interface UpdateConnectionInput {
    id: number;
    body: UpdateCalendarConnection;
}

/**
 * `PATCH /users/me/calendars/:id` (ROK-1596 D6, `write` only), then refetch
 * the overview. A 409 rejects with the server's code as the message
 * (`write_already_enabled` / `needs_consent`); read it with `httpStatusOf`.
 */
export function useUpdateConnection() {
    const queryClient = useQueryClient();
    return useMutation<void, Error, UpdateConnectionInput>({
        // D6 names no response body, so none is parsed; the overview refetch is the source of truth.
        mutationFn: async ({ id, body }) => {
            await fetchApi<unknown>(`${BASE}/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
        },
        // Returned, not voided: the mutation stays pending until the refetch lands, so a
        // control showing the pending value never snaps back to the stale one in between.
        onSuccess: () => queryClient.invalidateQueries({ queryKey: [...CALENDARS_OVERVIEW_KEY] }),
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
            // Disconnect drops busy hours + synced away days server-side (ROK-1593).
            void queryClient.invalidateQueries({ queryKey: GAME_TIME_QUERY_KEY });
            void queryClient.invalidateQueries({ queryKey: GAME_TIME_ABSENCES_KEY });
            void queryClient.invalidateQueries({ queryKey: ['scheduling'] });
        },
    });
}

export const eventCopyKey = (eventId: number) => ['calendars', 'event-copy', eventId] as const;

/** A `pending` copy is re-read this often (the server writes it after a ~5 s debounce)… */
export const COPY_POLL_MS = 3_000;
/** …for at most this long; after that the window-focus refetch takes over. */
export const COPY_POLL_MAX_MS = 60_000;

/** Poll only while the copy is `pending`, and only for {@link COPY_POLL_MAX_MS} since it went pending. */
export function copyPollInterval(state: EventCalendarCopy['state'] | undefined, pendingSince: number | null, now = Date.now()): number | false {
    if (state !== 'pending' || pendingSince === null) return false;
    return now - pendingSince < COPY_POLL_MAX_MS ? COPY_POLL_MS : false;
}

/**
 * GET one event's copy. The server's null is an EMPTY 200 body (Nest's null
 * return), which `response.json()` would throw on — so read the text first.
 */
async function fetchEventCopy(eventId: number): Promise<EventCalendarCopy | null> {
    const res = await fetchWithAuth(`${BASE}/events/${eventId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!text.trim()) return null;
    return EventCalendarCopySchema.nullable().parse(JSON.parse(text));
}

/** `GET /users/me/calendars/events/:eventId` — our copy of this event, or null (no write connection). */
export function useEventCalendarCopy(eventId: number, enabled = true) {
    const pendingSince = useRef<number | null>(null);
    return useQuery<EventCalendarCopy | null>({
        queryKey: eventCopyKey(eventId),
        queryFn: () => fetchEventCopy(eventId),
        enabled: enabled && !!getAuthToken(),
        retry: false,
        refetchInterval: (query) => {
            const state = query.state.data?.state;
            if (state !== 'pending') { pendingSince.current = null; return false; }
            pendingSince.current ??= Date.now();
            return copyPollInterval(state, pendingSince.current);
        },
    });
}

/** `POST …/events/:eventId/undo` → 204: removes that one copy (link `suppressed`), never the sign-up (Q4). */
export function useUndoCalendarCopy(eventId: number) {
    const queryClient = useQueryClient();
    return useMutation<void, Error, void>({
        mutationFn: async () => {
            const res = await fetchWithAuth(`${BASE}/events/${eventId}/undo`, { method: 'POST' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: eventCopyKey(eventId) });
        },
    });
}

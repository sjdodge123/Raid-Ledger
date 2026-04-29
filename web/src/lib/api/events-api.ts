import type {
    EventListResponseDto,
    EventResponseDto,
    EventRosterDto,
    EventDetailResponseDto,
    DashboardResponseDto,
    SignupResponseDto,
    CreateEventDto,
    UpdateEventDto,
    RosterAvailabilityResponse,
    RosterWithAssignments,
    UpdateRosterDto,
    AggregateGameTimeResponse,
    RescheduleEventDto,
    AttendanceSummaryDto,
    AttendanceStatus,
} from '@raid-ledger/contract';
import {
    EventListResponseSchema,
    EventResponseSchema,
    EventRosterSchema,
    EventDetailResponseSchema,
    SignupResponseSchema,
} from '@raid-ledger/contract';
import { fetchApi } from './fetch-api';

/**
 * Parameters for event list queries
 */
export interface EventListParams {
    page?: number;
    limit?: number;
    upcoming?: boolean;
    startAfter?: string;
    endBefore?: string;
    gameId?: string;
    includeSignups?: boolean;
    creatorId?: string;
    signedUpAs?: string;
}

/** Build query string from event list params */
function buildEventQuery(params: EventListParams): string {
    const sp = new URLSearchParams();
    if (params.page) sp.set('page', String(params.page));
    if (params.limit) sp.set('limit', String(params.limit));
    if (params.upcoming !== undefined) sp.set('upcoming', String(params.upcoming));
    if (params.startAfter) sp.set('startAfter', params.startAfter);
    if (params.endBefore) sp.set('endBefore', params.endBefore);
    if (params.gameId) sp.set('gameId', params.gameId);
    if (params.includeSignups) sp.set('includeSignups', 'true');
    if (params.creatorId) sp.set('creatorId', params.creatorId);
    if (params.signedUpAs) sp.set('signedUpAs', params.signedUpAs);
    return sp.toString();
}

/** Fetch paginated event list */
export async function getEvents(
    params: EventListParams = {},
): Promise<EventListResponseDto> {
    const query = buildEventQuery(params);
    const endpoint = `/events${query ? `?${query}` : ''}`;
    return fetchApi(endpoint, {}, EventListResponseSchema);
}

/** Fetch a single event by ID */
export async function getEvent(
    eventId: number,
): Promise<EventResponseDto> {
    return fetchApi(`/events/${eventId}`, {}, EventResponseSchema);
}

/** Fetch event roster */
export async function getEventRoster(
    eventId: number,
): Promise<EventRosterDto> {
    return fetchApi(`/events/${eventId}/roster`, {}, EventRosterSchema);
}

/** Fetch composite event detail bundle (ROK-1046) */
export async function getEventDetail(
    eventId: number,
): Promise<EventDetailResponseDto> {
    return fetchApi(`/events/${eventId}/detail`, {}, EventDetailResponseSchema);
}

/** Fetch event variant context (ROK-587) */
export async function getEventVariantContext(
    eventId: number,
): Promise<{ gameVariant: string | null; region: string | null }> {
    return fetchApi<{
        gameVariant: string | null;
        region: string | null;
    }>(`/events/${eventId}/variant-context`);
}

/** Create a new event */
export async function createEvent(
    dto: CreateEventDto,
): Promise<EventResponseDto> {
    return fetchApi(
        '/events',
        { method: 'POST', body: JSON.stringify(dto) },
        EventResponseSchema,
    );
}

/** Update an existing event */
export async function updateEvent(
    id: number,
    dto: UpdateEventDto,
): Promise<EventResponseDto> {
    return fetchApi(
        `/events/${id}`,
        { method: 'PATCH', body: JSON.stringify(dto) },
        EventResponseSchema,
    );
}

/** Cancel an event (soft-cancel, ROK-374) */
export async function cancelEvent(
    eventId: number,
    reason?: string,
): Promise<EventResponseDto> {
    return fetchApi(
        `/events/${eventId}/cancel`,
        { method: 'PATCH', body: JSON.stringify({ reason }) },
        EventResponseSchema,
    );
}

/** Fetch organizer dashboard data (ROK-213) */
export async function getMyDashboard(): Promise<DashboardResponseDto> {
    return fetchApi('/events/my-dashboard');
}

// -- Signups --

/** Signup options with optional slot preference, character, and preferred roles */
interface SignupOptions {
    note?: string;
    slotRole?: string;
    slotPosition?: number;
    characterId?: string;
    preferredRoles?: string[];
}

/** Sign up for an event */
export async function signupForEvent(
    eventId: number,
    options?: SignupOptions,
): Promise<SignupResponseDto> {
    return fetchApi(
        `/events/${eventId}/signup`,
        { method: 'POST', body: JSON.stringify(options ?? {}) },
        SignupResponseSchema,
    );
}

/** Cancel signup for an event */
export async function cancelSignup(eventId: number): Promise<void> {
    return fetchApi(`/events/${eventId}/signup`, { method: 'DELETE' });
}

/** Confirm signup with character selection (ROK-131) */
export async function confirmSignup(
    eventId: number,
    signupId: number,
    characterId: string,
): Promise<SignupResponseDto> {
    return fetchApi(
        `/events/${eventId}/signups/${signupId}/confirm`,
        { method: 'PATCH', body: JSON.stringify({ characterId }) },
        SignupResponseSchema,
    );
}

/** Update signup status (ROK-137) */
export async function updateSignupStatus(
    eventId: number,
    status: 'signed_up' | 'tentative' | 'declined',
): Promise<SignupResponseDto> {
    return fetchApi(
        `/events/${eventId}/signup/status`,
        { method: 'PATCH', body: JSON.stringify({ status }) },
        SignupResponseSchema,
    );
}

/** Redeem an intent token for deferred signup (ROK-137) */
export async function redeemIntent(
    token: string,
): Promise<{ success: boolean; eventId?: number; message: string }> {
    return fetchApi('/auth/redeem-intent', {
        method: 'POST',
        body: JSON.stringify({ token }),
    });
}

// -- Attendance --

/** Record attendance for a signup (ROK-421) */
export async function recordAttendance(
    eventId: number,
    signupId: number,
    attendanceStatus: AttendanceStatus,
): Promise<SignupResponseDto> {
    return fetchApi(`/events/${eventId}/attendance`, {
        method: 'PATCH',
        body: JSON.stringify({ signupId, attendanceStatus }),
    });
}

/** Get attendance summary for an event */
export async function getAttendanceSummary(
    eventId: number,
): Promise<AttendanceSummaryDto> {
    return fetchApi(`/events/${eventId}/attendance`);
}

// -- Roster --

/** Get roster with assignment data */
export async function getRosterWithAssignments(
    eventId: number,
): Promise<RosterWithAssignments> {
    return fetchApi(`/events/${eventId}/roster/assignments`);
}

/** Update roster assignments (drag-and-drop) */
export async function updateRoster(
    eventId: number,
    dto: UpdateRosterDto,
): Promise<RosterWithAssignments> {
    return fetchApi(`/events/${eventId}/roster`, {
        method: 'PATCH',
        body: JSON.stringify(dto),
    });
}

/** Self-unassign from roster slot (ROK-226) */
export async function selfUnassignFromRoster(
    eventId: number,
): Promise<RosterWithAssignments> {
    return fetchApi(`/events/${eventId}/roster/me`, { method: 'DELETE' });
}

/** Admin-remove a signup from an event (ROK-402) */
export async function adminRemoveUserFromEvent(
    eventId: number,
    signupId: number,
): Promise<void> {
    return fetchApi(`/events/${eventId}/signups/${signupId}`, {
        method: 'DELETE',
    });
}

// -- Roster Availability --

export interface RosterAvailabilityParams {
    from?: string;
    to?: string;
}

/** Fetch availability for all signed-up users in an event */
export async function getRosterAvailability(
    eventId: number,
    params?: RosterAvailabilityParams,
): Promise<RosterAvailabilityResponse> {
    const sp = new URLSearchParams();
    if (params?.from) sp.set('from', params.from);
    if (params?.to) sp.set('to', params.to);
    const query = sp.toString();
    return fetchApi(
        `/events/${eventId}/roster/availability${query ? `?${query}` : ''}`,
    );
}

// -- Aggregate Game Time & Reschedule (ROK-223) --

/** Fetch aggregate game time heatmap for event */
export async function getAggregateGameTime(
    eventId: number,
): Promise<AggregateGameTimeResponse> {
    return fetchApi(`/events/${eventId}/aggregate-game-time`);
}

/** Reschedule an event to a new time */
export async function rescheduleEvent(
    eventId: number,
    dto: RescheduleEventDto,
): Promise<EventResponseDto> {
    return fetchApi(
        `/events/${eventId}/reschedule`,
        { method: 'PATCH', body: JSON.stringify(dto) },
        EventResponseSchema,
    );
}

/** Delete a single event (ROK-429). */
export async function deleteEvent(
    eventId: number,
): Promise<{ message: string }> {
    return fetchApi(`/events/${eventId}`, { method: 'DELETE' });
}

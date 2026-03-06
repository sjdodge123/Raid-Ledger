import type {
    CreateEventPlanDto,
    EventPlanResponseDto,
    TimeSuggestionsResponse,
    PollResultsResponse,
} from '@raid-ledger/contract';
import { fetchApi } from './fetch-api';

/** Get smart time suggestions for poll-based scheduling */
export async function getTimeSuggestions(params?: {
    gameId?: number;
    tzOffset?: number;
    afterDate?: string;
}): Promise<TimeSuggestionsResponse> {
    const sp = new URLSearchParams();
    if (params?.gameId) sp.set('gameId', String(params.gameId));
    if (params?.tzOffset !== undefined) {
        sp.set('tzOffset', String(params.tzOffset));
    }
    if (params?.afterDate) sp.set('afterDate', params.afterDate);
    const query = sp.toString();
    return fetchApi(
        `/event-plans/time-suggestions${query ? `?${query}` : ''}`,
    );
}

/** Create an event plan (posts Discord poll) */
export async function createEventPlan(
    dto: CreateEventPlanDto,
): Promise<EventPlanResponseDto> {
    return fetchApi('/event-plans', {
        method: 'POST',
        body: JSON.stringify(dto),
    });
}

/** Get current user's event plans */
export async function getMyEventPlans(): Promise<EventPlanResponseDto[]> {
    return fetchApi('/event-plans/my-plans');
}

/** Get a single event plan by ID */
export async function getEventPlan(
    planId: string,
): Promise<EventPlanResponseDto> {
    return fetchApi(`/event-plans/${planId}`);
}

/** Cancel an active event plan */
export async function cancelEventPlan(
    planId: string,
): Promise<EventPlanResponseDto> {
    return fetchApi(`/event-plans/${planId}/cancel`, {
        method: 'PATCH',
    });
}

/** Get poll results for an active plan */
export async function getEventPlanPollResults(
    planId: string,
): Promise<PollResultsResponse> {
    return fetchApi(`/event-plans/${planId}/poll-results`);
}

/** Restart a cancelled or expired event plan */
export async function restartEventPlan(
    planId: string,
): Promise<EventPlanResponseDto> {
    return fetchApi(`/event-plans/${planId}/restart`, {
        method: 'PATCH',
    });
}

/** Convert an existing event to an event plan */
export async function convertEventToPlan(
    eventId: number,
    options?: {
        cancelOriginal?: boolean;
        pollDurationHours?: number;
    },
): Promise<EventPlanResponseDto> {
    return fetchApi(`/event-plans/from-event/${eventId}`, {
        method: 'POST',
        body: JSON.stringify(options ?? {}),
    });
}

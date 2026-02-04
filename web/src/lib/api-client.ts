import type {
    EventListResponseDto,
    EventResponseDto,
    EventRosterDto,
    SignupResponseDto,
    CharacterListResponseDto,
} from '@raid-ledger/contract';
import {
    EventListResponseSchema,
    EventResponseSchema,
    EventRosterSchema,
    SignupResponseSchema,
    CharacterListResponseSchema,
} from '@raid-ledger/contract';
import { API_BASE_URL } from './config';

/**
 * Generic fetch wrapper with Zod validation
 */
async function fetchApi<T>(
    endpoint: string,
    options: RequestInit = {},
    schema?: { parse: (data: unknown) => T }
): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;

    const response = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers,
        },
        credentials: 'include', // Include cookies for auth
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Request failed' }));
        throw new Error(error.message || `HTTP ${response.status}`);
    }

    // Handle 204 No Content
    if (response.status === 204) {
        return undefined as T;
    }

    const data = await response.json();

    // Validate with Zod schema if provided
    if (schema) {
        return schema.parse(data);
    }

    return data as T;
}

// ============================================================
// Events API
// ============================================================

export interface EventListParams {
    page?: number;
    limit?: number;
    upcoming?: boolean;
}

export async function getEvents(params: EventListParams = {}): Promise<EventListResponseDto> {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set('page', String(params.page));
    if (params.limit) searchParams.set('limit', String(params.limit));
    if (params.upcoming !== undefined) searchParams.set('upcoming', String(params.upcoming));

    const query = searchParams.toString();
    const endpoint = `/events${query ? `?${query}` : ''}`;

    return fetchApi(endpoint, {}, EventListResponseSchema);
}

export async function getEvent(eventId: number): Promise<EventResponseDto> {
    return fetchApi(`/events/${eventId}`, {}, EventResponseSchema);
}

export async function getEventRoster(eventId: number): Promise<EventRosterDto> {
    return fetchApi(`/events/${eventId}/roster`, {}, EventRosterSchema);
}

// ============================================================
// Signups API
// ============================================================

export async function signupForEvent(eventId: number, note?: string): Promise<SignupResponseDto> {
    return fetchApi(
        `/events/${eventId}/signup`,
        {
            method: 'POST',
            body: JSON.stringify({ note }),
        },
        SignupResponseSchema
    );
}

export async function cancelSignup(eventId: number): Promise<void> {
    return fetchApi(`/events/${eventId}/signup`, { method: 'DELETE' });
}

/**
 * Confirm signup with character selection (ROK-131)
 */
export async function confirmSignup(
    eventId: number,
    signupId: number,
    characterId: string
): Promise<SignupResponseDto> {
    return fetchApi(
        `/events/${eventId}/signups/${signupId}/confirm`,
        {
            method: 'PATCH',
            body: JSON.stringify({ characterId }),
        },
        SignupResponseSchema
    );
}

// ============================================================
// Characters API
// ============================================================

/**
 * Fetch current user's characters, optionally filtered by game
 */
export async function getMyCharacters(gameId?: string): Promise<CharacterListResponseDto> {
    const params = gameId ? `?gameId=${gameId}` : '';
    return fetchApi(`/users/me/characters${params}`, {}, CharacterListResponseSchema);
}

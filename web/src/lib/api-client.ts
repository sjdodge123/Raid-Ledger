import type {
    EventListResponseDto,
    EventResponseDto,
    EventRosterDto,
    SignupResponseDto,
    CharacterListResponseDto,
    GameSearchResponseDto,
    CreateEventDto,
    CreateCharacterDto,
    UpdateCharacterDto,
    CharacterDto,
    AvailabilityListResponseDto,
    AvailabilityWithConflicts,
    CreateAvailabilityInput,
    UpdateAvailabilityDto,
} from '@raid-ledger/contract';
import {
    EventListResponseSchema,
    EventResponseSchema,
    EventRosterSchema,
    SignupResponseSchema,
    CharacterListResponseSchema,
    GameSearchResponseSchema,
    CharacterSchema,
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

/**
 * Create a new event
 */
export async function createEvent(dto: CreateEventDto): Promise<EventResponseDto> {
    return fetchApi(
        '/events',
        {
            method: 'POST',
            body: JSON.stringify(dto),
        },
        EventResponseSchema
    );
}

// ============================================================
// Games API (IGDB Search)
// ============================================================

/**
 * Search for games via IGDB
 */
export async function searchGames(query: string): Promise<GameSearchResponseDto> {
    const params = new URLSearchParams({ q: query });
    return fetchApi(`/games/search?${params}`, {}, GameSearchResponseSchema);
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

/**
 * Create a new character
 */
export async function createCharacter(dto: CreateCharacterDto): Promise<CharacterDto> {
    return fetchApi(
        '/users/me/characters',
        {
            method: 'POST',
            body: JSON.stringify(dto),
        },
        CharacterSchema
    );
}

/**
 * Update a character
 */
export async function updateCharacter(
    characterId: string,
    dto: UpdateCharacterDto
): Promise<CharacterDto> {
    return fetchApi(
        `/users/me/characters/${characterId}`,
        {
            method: 'PATCH',
            body: JSON.stringify(dto),
        },
        CharacterSchema
    );
}

/**
 * Set a character as main (swaps if another was main for that game)
 */
export async function setMainCharacter(characterId: string): Promise<CharacterDto> {
    return fetchApi(
        `/users/me/characters/${characterId}/main`,
        { method: 'PATCH' },
        CharacterSchema
    );
}

/**
 * Delete a character
 */
export async function deleteCharacter(characterId: string): Promise<void> {
    return fetchApi(`/users/me/characters/${characterId}`, { method: 'DELETE' });
}

// ============================================================
// Availability API (ROK-112)
// ============================================================

export interface AvailabilityQueryParams {
    from?: string;
    to?: string;
    gameId?: string;
}

/**
 * Fetch current user's availability windows
 */
export async function getMyAvailability(
    options?: AvailabilityQueryParams
): Promise<AvailabilityListResponseDto> {
    const params = new URLSearchParams();
    if (options?.from) params.set('from', options.from);
    if (options?.to) params.set('to', options.to);
    if (options?.gameId) params.set('gameId', options.gameId);
    const query = params.toString();
    return fetchApi(`/users/me/availability${query ? `?${query}` : ''}`);
}

/**
 * Create a new availability window
 */
export async function createAvailability(
    dto: CreateAvailabilityInput
): Promise<AvailabilityWithConflicts> {
    return fetchApi('/users/me/availability', {
        method: 'POST',
        body: JSON.stringify(dto),
    });
}

/**
 * Update an existing availability window
 */
export async function updateAvailability(
    id: string,
    dto: UpdateAvailabilityDto
): Promise<AvailabilityWithConflicts> {
    return fetchApi(`/users/me/availability/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(dto),
    });
}

/**
 * Delete an availability window
 */
export async function deleteAvailability(id: string): Promise<void> {
    return fetchApi(`/users/me/availability/${id}`, { method: 'DELETE' });
}

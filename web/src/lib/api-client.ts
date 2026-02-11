import type {
    EventListResponseDto,
    EventResponseDto,
    EventRosterDto,
    DashboardResponseDto,
    SignupResponseDto,
    CharacterListResponseDto,
    GameSearchResponseDto,
    GameRegistryListResponseDto,
    EventTypesResponseDto,
    CreateEventDto,
    UpdateEventDto,
    CreateCharacterDto,
    UpdateCharacterDto,
    CharacterDto,
    ImportWowCharacterInput,
    RefreshCharacterInput,
    WowRealmListResponseDto,
    BlizzardCharacterPreviewDto,
    WowInstanceListResponseDto,
    WowInstanceDetailDto,
    AvailabilityListResponseDto,
    AvailabilityWithConflicts,
    CreateAvailabilityInput,
    UpdateAvailabilityDto,
    RosterAvailabilityResponse,
    RosterWithAssignments,
    UpdateRosterDto,
    UserProfileDto,
    PlayersListResponseDto,
    GameTimeResponse,
    GameTimeTemplateInput,
    CreateTemplateDto,
    TemplateResponseDto,
    TemplateListResponseDto,
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
import { getAuthToken } from '../hooks/use-auth';

/**
 * Generic fetch wrapper with Zod validation
 */
async function fetchApi<T>(
    endpoint: string,
    options: RequestInit = {},
    schema?: { parse: (data: unknown) => T }
): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;

    // Include Authorization header if token exists
    const token = getAuthToken();
    const authHeaders: Record<string, string> = {};
    if (token) {
        authHeaders['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...authHeaders,
            ...options.headers,
        },
        credentials: 'include', // Include cookies for auth
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Request failed' }));
        // Include specific validation errors if available (Zod backend errors)
        const details = Array.isArray(error.errors) ? error.errors.join(', ') : '';
        const message = details
            ? `${error.message || 'Request failed'}: ${details}`
            : error.message || `HTTP ${response.status}`;
        throw new Error(message);
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

/**
 * Parameters for event list queries (ROK-174: Date Range Filtering, ROK-177: Signups Preview)
 */
export interface EventListParams {
    page?: number;
    limit?: number;
    upcoming?: boolean;
    /** ISO8601 datetime - filter events starting after this date */
    startAfter?: string;
    /** ISO8601 datetime - filter events ending before this date */
    endBefore?: string;
    /** Filter events by game ID */
    gameId?: string;
    /** Include first N signups preview for calendar views (ROK-177) */
    includeSignups?: boolean;
    /** Filter by creator ID — use "me" for current user (ROK-213) */
    creatorId?: string;
    /** Filter events user signed up for — use "me" (ROK-213) */
    signedUpAs?: string;
}

export async function getEvents(params: EventListParams = {}): Promise<EventListResponseDto> {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set('page', String(params.page));
    if (params.limit) searchParams.set('limit', String(params.limit));
    if (params.upcoming !== undefined) searchParams.set('upcoming', String(params.upcoming));
    if (params.startAfter) searchParams.set('startAfter', params.startAfter);
    if (params.endBefore) searchParams.set('endBefore', params.endBefore);
    if (params.gameId) searchParams.set('gameId', params.gameId);
    if (params.includeSignups) searchParams.set('includeSignups', 'true');
    if (params.creatorId) searchParams.set('creatorId', params.creatorId);
    if (params.signedUpAs) searchParams.set('signedUpAs', params.signedUpAs);

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

export async function updateEvent(id: number, dto: UpdateEventDto): Promise<EventResponseDto> {
    return fetchApi(
        `/events/${id}`,
        {
            method: 'PATCH',
            body: JSON.stringify(dto),
        },
        EventResponseSchema
    );
}

/**
 * Fetch organizer dashboard data (ROK-213)
 */
export async function getMyDashboard(): Promise<DashboardResponseDto> {
    return fetchApi('/events/my-dashboard');
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

/**
 * Fetch all registered games from the game registry
 */
export async function fetchGameRegistry(): Promise<GameRegistryListResponseDto> {
    return fetchApi('/game-registry');
}

/**
 * Fetch event types for a specific registry game
 */
export async function getGameEventTypes(registryGameId: string): Promise<EventTypesResponseDto> {
    return fetchApi(`/game-registry/${registryGameId}/event-types`);
}

// ============================================================
// Signups API
// ============================================================

/** ROK-183: Signup options with optional slot preference */
interface SignupOptions {
    note?: string;
    slotRole?: string;
    slotPosition?: number;
}

export async function signupForEvent(eventId: number, options?: SignupOptions): Promise<SignupResponseDto> {
    return fetchApi(
        `/events/${eventId}/signup`,
        {
            method: 'POST',
            body: JSON.stringify(options ?? {}),
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

/**
 * Import a WoW character from Blizzard Armory (ROK-234)
 */
export async function importWowCharacter(dto: ImportWowCharacterInput): Promise<CharacterDto> {
    return fetchApi(
        '/users/me/characters/import/wow',
        {
            method: 'POST',
            body: JSON.stringify(dto),
        },
        CharacterSchema
    );
}

/**
 * Fetch a single character by ID (public — for detail page)
 */
export async function getCharacterDetail(characterId: string): Promise<CharacterDto> {
    return fetchApi(`/characters/${characterId}`, {}, CharacterSchema);
}

/**
 * Refresh a character's data from Blizzard Armory (ROK-234)
 */
export async function refreshCharacterFromArmory(
    characterId: string,
    dto: RefreshCharacterInput
): Promise<CharacterDto> {
    return fetchApi(
        `/users/me/characters/${characterId}/refresh`,
        {
            method: 'POST',
            body: JSON.stringify(dto),
        },
        CharacterSchema
    );
}

/**
 * Fetch WoW realm list for autocomplete (ROK-234 UX)
 */
export async function fetchWowRealms(
    region: string,
    gameVariant?: string,
): Promise<WowRealmListResponseDto> {
    const params = new URLSearchParams({ region });
    if (gameVariant) params.set('gameVariant', gameVariant);
    return fetchApi(`/blizzard/realms?${params}`);
}

/**
 * Preview a WoW character from Blizzard without saving (ROK-234 UX)
 */
export async function previewWowCharacter(
    name: string,
    realm: string,
    region: string,
    gameVariant?: string,
): Promise<BlizzardCharacterPreviewDto> {
    const params = new URLSearchParams({ name, realm, region });
    if (gameVariant) params.set('gameVariant', gameVariant);
    return fetchApi(`/blizzard/character-preview?${params}`);
}

/**
 * Fetch WoW dungeon/raid instances for content selection
 */
export async function fetchWowInstances(
    gameVariant: string,
    type: 'dungeon' | 'raid',
): Promise<WowInstanceListResponseDto> {
    const params = new URLSearchParams({ gameVariant, type });
    return fetchApi(`/blizzard/instances?${params}`);
}

/**
 * Fetch detail for a specific WoW instance (level requirements, player count)
 */
export async function fetchWowInstanceDetail(
    instanceId: number,
    gameVariant: string,
): Promise<WowInstanceDetailDto> {
    const params = new URLSearchParams({ gameVariant });
    return fetchApi(`/blizzard/instance/${instanceId}?${params}`);
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

// ============================================================
// Roster Availability API (ROK-113)
// ============================================================

export interface RosterAvailabilityParams {
    from?: string;
    to?: string;
}

/**
 * Fetch availability for all signed-up users in an event (for heatmap)
 */
export async function getRosterAvailability(
    eventId: number,
    params?: RosterAvailabilityParams
): Promise<RosterAvailabilityResponse> {
    const searchParams = new URLSearchParams();
    if (params?.from) searchParams.set('from', params.from);
    if (params?.to) searchParams.set('to', params.to);
    const query = searchParams.toString();
    return fetchApi(`/events/${eventId}/roster/availability${query ? `?${query}` : ''}`);
}

// ============================================================
// Roster Assignments API (ROK-114)
// ============================================================

/**
 * Get roster with assignment data (pool and assigned users)
 */
export async function getRosterWithAssignments(
    eventId: number
): Promise<RosterWithAssignments> {
    return fetchApi(`/events/${eventId}/roster/assignments`);
}

/**
 * Update roster assignments (drag-and-drop changes)
 */
export async function updateRoster(
    eventId: number,
    dto: UpdateRosterDto
): Promise<RosterWithAssignments> {
    return fetchApi(`/events/${eventId}/roster`, {
        method: 'PATCH',
        body: JSON.stringify(dto),
    });
}

/**
 * Self-unassign from roster slot (ROK-226).
 * Removes the current user's assignment but keeps signup.
 */
export async function selfUnassignFromRoster(
    eventId: number,
): Promise<RosterWithAssignments> {
    return fetchApi(`/events/${eventId}/roster/me`, {
        method: 'DELETE',
    });
}

// ============================================================
// Discord Integration API (ROK-195)
// ============================================================

/**
 * Unlink Discord from the current user's account
 */
export async function unlinkDiscord(): Promise<void> {
    return fetchApi('/users/me/discord', { method: 'DELETE' });
}

// ============================================================
// User Profiles API (ROK-181)
// ============================================================

/**
 * Fetch paginated player list (public)
 */
export async function getPlayers(params?: { page?: number; search?: string }): Promise<PlayersListResponseDto> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.search) searchParams.set('search', params.search);
    const query = searchParams.toString();
    return fetchApi(`/users${query ? `?${query}` : ''}`);
}

/**
 * Fetch a user's public profile by ID
 */
export async function getUserProfile(userId: number): Promise<UserProfileDto> {
    const response = await fetchApi<{ data: UserProfileDto }>(`/users/${userId}/profile`);
    return response.data;
}

// ============================================================
// Game Time API (ROK-189)
// ============================================================

/**
 * Fetch current user's game time (composite view: template + event commitments).
 * Automatically sends browser timezone offset so event overlays render in local time.
 */
export async function getMyGameTime(week?: string, tzOffsetOverride?: number): Promise<GameTimeResponse> {
    const searchParams = new URLSearchParams();
    if (week) searchParams.set('week', week);
    // Send timezone offset so backend converts UTC event times to local grid cells
    searchParams.set('tzOffset', String(tzOffsetOverride ?? new Date().getTimezoneOffset()));
    const query = searchParams.toString();
    const response = await fetchApi<{ data: GameTimeResponse }>(`/users/me/game-time?${query}`);
    return response.data;
}

/**
 * Save current user's game time template (replaces all slots)
 */
export async function saveMyGameTime(
    slots: GameTimeTemplateInput['slots'],
): Promise<GameTimeResponse> {
    const response = await fetchApi<{ data: GameTimeResponse }>('/users/me/game-time', {
        method: 'PUT',
        body: JSON.stringify({ slots }),
    });
    return response.data;
}

/**
 * Save per-hour date-specific overrides
 */
export async function saveMyGameTimeOverrides(
    overrides: Array<{ date: string; hour: number; status: string }>,
): Promise<void> {
    await fetchApi('/users/me/game-time/overrides', {
        method: 'PUT',
        body: JSON.stringify({ overrides }),
    });
}

/**
 * Create an absence range
 */
export async function createGameTimeAbsence(
    input: { startDate: string; endDate: string; reason?: string },
): Promise<{ id: number; startDate: string; endDate: string; reason: string | null }> {
    const response = await fetchApi<{ data: { id: number; startDate: string; endDate: string; reason: string | null } }>(
        '/users/me/game-time/absences',
        { method: 'POST', body: JSON.stringify(input) },
    );
    return response.data;
}

/**
 * Delete an absence
 */
export async function deleteGameTimeAbsence(id: number): Promise<void> {
    await fetchApi(`/users/me/game-time/absences/${id}`, { method: 'DELETE' });
}

/**
 * List all absences for current user
 */
export async function getGameTimeAbsences(): Promise<Array<{ id: number; startDate: string; endDate: string; reason: string | null }>> {
    const response = await fetchApi<{ data: Array<{ id: number; startDate: string; endDate: string; reason: string | null }> }>(
        '/users/me/game-time/absences',
    );
    return response.data;
}

// ============================================================
// Preferences API (ROK-124)
// ============================================================

/**
 * Fetch current user's preferences as a key-value map.
 */
export async function getMyPreferences(): Promise<Record<string, unknown>> {
    const response = await fetchApi<{ data: Record<string, unknown> }>('/users/me/preferences');
    return response.data;
}

/**
 * Update a single user preference (upsert).
 */
export async function updatePreference(key: string, value: unknown): Promise<void> {
    await fetchApi('/users/me/preferences', {
        method: 'PATCH',
        body: JSON.stringify({ key, value }),
    });
}

// ============================================================
// Event Templates API
// ============================================================

export async function getEventTemplates(): Promise<TemplateListResponseDto> {
    return fetchApi<TemplateListResponseDto>('/event-templates');
}

export async function createEventTemplate(dto: CreateTemplateDto): Promise<TemplateResponseDto> {
    return fetchApi<TemplateResponseDto>('/event-templates', {
        method: 'POST',
        body: JSON.stringify(dto),
    });
}

export async function deleteEventTemplate(id: number): Promise<void> {
    await fetchApi(`/event-templates/${id}`, { method: 'DELETE' });
}

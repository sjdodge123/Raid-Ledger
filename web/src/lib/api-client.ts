import type {
    PluginInfoDto,
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
    AvailabilityListResponseDto,
    AvailabilityWithConflicts,
    CreateAvailabilityInput,
    UpdateAvailabilityDto,
    RosterAvailabilityResponse,
    RosterWithAssignments,
    UpdateRosterDto,
    UserProfileDto,
    PlayersListResponseDto,
    RecentPlayersResponseDto,
    GameTimeResponse,
    GameTimeTemplateInput,
    CreateTemplateDto,
    TemplateResponseDto,
    TemplateListResponseDto,
    AggregateGameTimeResponse,
    RescheduleEventDto,
    UserHeartedGamesResponseDto,
    UserEventSignupsResponseDto,
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
export async function fetchApi<T>(
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

    // Don't set Content-Type for FormData — browser will set it with boundary
    const isFormData = options.body instanceof FormData;
    const contentHeaders: Record<string, string> = isFormData
        ? {}
        : { 'Content-Type': 'application/json' };

    const response = await fetch(url, {
        ...options,
        headers: {
            ...contentHeaders,
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
// Avatar API (ROK-220)
// ============================================================

/**
 * Upload a custom avatar image with optional progress tracking.
 * Uses XMLHttpRequest for upload progress when onProgress is provided.
 */
export async function uploadAvatar(
    file: File,
    onProgress?: (percent: number) => void,
): Promise<{ customAvatarUrl: string }> {
    const formData = new FormData();
    formData.append('avatar', file);

    if (onProgress) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', `${API_BASE_URL}/users/me/avatar`);

            const token = getAuthToken();
            if (token) {
                xhr.setRequestHeader('Authorization', `Bearer ${token}`);
            }

            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    onProgress(Math.round((e.loaded / e.total) * 100));
                }
            });

            xhr.addEventListener('load', () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    const response = JSON.parse(xhr.responseText) as { data: { customAvatarUrl: string } };
                    resolve(response.data);
                } else {
                    try {
                        const error = JSON.parse(xhr.responseText) as { message?: string };
                        reject(new Error(error.message || `HTTP ${xhr.status}`));
                    } catch {
                        reject(new Error(`HTTP ${xhr.status}`));
                    }
                }
            });

            xhr.addEventListener('error', () => reject(new Error('Upload failed')));
            xhr.send(formData);
        });
    }

    const response = await fetchApi<{ data: { customAvatarUrl: string } }>('/users/me/avatar', {
        method: 'POST',
        body: formData,
        headers: {}, // Let browser set Content-Type with boundary
    });
    return response.data;
}

/**
 * Delete the current user's custom avatar.
 */
export async function deleteCustomAvatar(): Promise<void> {
    return fetchApi('/users/me/avatar', { method: 'DELETE' });
}

/**
 * Admin: remove any user's custom avatar.
 */
export async function adminRemoveAvatar(userId: number): Promise<void> {
    return fetchApi(`/users/${userId}/avatar`, { method: 'DELETE' });
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
 * Cancel an event (soft-cancel) (ROK-374)
 */
export async function cancelEvent(
    eventId: number,
    reason?: string,
): Promise<EventResponseDto> {
    return fetchApi(
        `/events/${eventId}/cancel`,
        {
            method: 'PATCH',
            body: JSON.stringify({ reason }),
        },
        EventResponseSchema,
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

/**
 * Update signup status (ROK-137)
 */
export async function updateSignupStatus(
    eventId: number,
    status: 'signed_up' | 'tentative' | 'declined',
): Promise<SignupResponseDto> {
    return fetchApi(
        `/events/${eventId}/signup/status`,
        {
            method: 'PATCH',
            body: JSON.stringify({ status }),
        },
        SignupResponseSchema,
    );
}

/**
 * Redeem an intent token for deferred signup (ROK-137)
 */
export async function redeemIntent(
    token: string,
): Promise<{ success: boolean; eventId?: number; message: string }> {
    return fetchApi('/auth/redeem-intent', {
        method: 'POST',
        body: JSON.stringify({ token }),
    });
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
        `/users/me/characters/${characterId}/set-main`,
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
 * Fetch a single character by ID (public — for detail page)
 */
export async function getCharacterDetail(characterId: string): Promise<CharacterDto> {
    return fetchApi(`/characters/${characterId}`, {}, CharacterSchema);
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
// Aggregate Game Time & Reschedule API (ROK-223)
// ============================================================

/**
 * Fetch aggregate game time heatmap for signed-up users of an event
 */
export async function getAggregateGameTime(eventId: number): Promise<AggregateGameTimeResponse> {
    return fetchApi(`/events/${eventId}/aggregate-game-time`);
}

/**
 * Reschedule an event to a new time
 */
export async function rescheduleEvent(eventId: number, dto: RescheduleEventDto): Promise<EventResponseDto> {
    return fetchApi(
        `/events/${eventId}/reschedule`,
        {
            method: 'PATCH',
            body: JSON.stringify(dto),
        },
        EventResponseSchema
    );
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
export async function getPlayers(params?: { page?: number; search?: string; gameId?: number }): Promise<PlayersListResponseDto> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.search) searchParams.set('search', params.search);
    if (params?.gameId) searchParams.set('gameId', String(params.gameId));
    const query = searchParams.toString();
    return fetchApi(`/users${query ? `?${query}` : ''}`);
}

/**
 * Fetch recently joined players (last 30 days, max 10) for the New Members section (ROK-298).
 */
export async function getRecentPlayers(): Promise<RecentPlayersResponseDto> {
    return fetchApi('/users/recent');
}

/**
 * Fetch a user's public profile by ID
 */
export async function getUserProfile(userId: number): Promise<UserProfileDto> {
    const response = await fetchApi<{ data: UserProfileDto }>(`/users/${userId}/profile`);
    return response.data;
}

/**
 * ROK-282: Fetch games a user has hearted.
 */
export async function getUserHeartedGames(userId: number): Promise<UserHeartedGamesResponseDto> {
    return fetchApi(`/users/${userId}/hearted-games`);
}

/**
 * ROK-299: Fetch upcoming events a user has signed up for.
 */
export async function getUserEventSignups(userId: number): Promise<UserEventSignupsResponseDto> {
    return fetchApi(`/users/${userId}/events/signups`);
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

// ============================================================
// Plugin Admin API (ROK-239)
// ============================================================

export async function getPlugins(): Promise<PluginInfoDto[]> {
    const response = await fetchApi<{ data: PluginInfoDto[] }>('/admin/plugins');
    return response.data;
}

export async function installPlugin(slug: string): Promise<void> {
    await fetchApi(`/admin/plugins/${slug}/install`, { method: 'POST' });
}

export async function uninstallPlugin(slug: string): Promise<void> {
    await fetchApi(`/admin/plugins/${slug}/uninstall`, { method: 'POST' });
}

export async function activatePlugin(slug: string): Promise<void> {
    await fetchApi(`/admin/plugins/${slug}/activate`, { method: 'POST' });
}

export async function deactivatePlugin(slug: string): Promise<void> {
    await fetchApi(`/admin/plugins/${slug}/deactivate`, { method: 'POST' });
}

// ============================================================
// User Management API (ROK-272)
// ============================================================

import type {
    UserManagementListResponseDto,
    UserRole,
    CreatePugSlotDto,
    UpdatePugSlotDto,
    PugSlotResponseDto,
    PugSlotListResponseDto,
    InviteCodeResolveResponseDto,
    ShareEventResponseDto,
} from '@raid-ledger/contract';

/**
 * Fetch paginated list of users with role info (admin-only).
 */
export async function getUsersForManagement(params?: {
    page?: number;
    limit?: number;
    search?: string;
}): Promise<UserManagementListResponseDto> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.search) searchParams.set('search', params.search);
    const query = searchParams.toString();
    return fetchApi(`/users/management${query ? `?${query}` : ''}`);
}

/**
 * Update a user's role (admin-only). Only member <-> operator.
 */
export async function updateUserRole(
    userId: number,
    role: Exclude<UserRole, 'admin'>,
): Promise<{ data: { id: number; username: string; role: UserRole } }> {
    return fetchApi(`/users/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
    });
}

// ============================================================
// PUG Slots API (ROK-262)
// ============================================================

/**
 * List PUG slots for an event
 */
export async function getEventPugs(eventId: number): Promise<PugSlotListResponseDto> {
    return fetchApi(`/events/${eventId}/pugs`);
}

/**
 * Add a PUG slot to an event
 */
export async function createPugSlot(
    eventId: number,
    dto: CreatePugSlotDto,
): Promise<PugSlotResponseDto> {
    return fetchApi(`/events/${eventId}/pugs`, {
        method: 'POST',
        body: JSON.stringify(dto),
    });
}

/**
 * Update a PUG slot
 */
export async function updatePugSlot(
    eventId: number,
    pugId: string,
    dto: UpdatePugSlotDto,
): Promise<PugSlotResponseDto> {
    return fetchApi(`/events/${eventId}/pugs/${pugId}`, {
        method: 'PATCH',
        body: JSON.stringify(dto),
    });
}

/**
 * Remove a PUG slot
 */
export async function deletePugSlot(
    eventId: number,
    pugId: string,
): Promise<void> {
    return fetchApi(`/events/${eventId}/pugs/${pugId}`, {
        method: 'DELETE',
    });
}

/**
 * Invite a registered member to an event (sends notification, not PUG).
 */
export async function inviteMember(
    eventId: number,
    discordId: string,
): Promise<{ message: string }> {
    return fetchApi(`/events/${eventId}/invite-member`, {
        method: 'POST',
        body: JSON.stringify({ discordId }),
    });
}

// ============================================================
// Discord Member Search (ROK-292)
// ============================================================

export interface DiscordMemberSearchResult {
    discordId: string;
    username: string;
    avatar: string | null;
    /** Whether this Discord user has a linked Raid Ledger account */
    isRegistered?: boolean;
}

/**
 * List Discord server members (initial load for Invite modal).
 * Available to any authenticated user.
 */
export async function listDiscordMembers(): Promise<DiscordMemberSearchResult[]> {
    return fetchApi('/discord/members/list');
}

/**
 * Search Discord server members by username query.
 * Available to any authenticated user.
 */
export async function searchDiscordMembers(
    query: string,
): Promise<DiscordMemberSearchResult[]> {
    return fetchApi(
        `/discord/members/search?q=${encodeURIComponent(query)}`,
    );
}

// ============================================================
// Invite Code API (ROK-263)
// ============================================================

/**
 * Resolve an invite code — public, no auth required.
 */
export async function resolveInviteCode(
    code: string,
): Promise<InviteCodeResolveResponseDto> {
    return fetchApi(`/invite/${code}`);
}

/**
 * Claim an invite code — requires auth.
 * Optional role override lets user select their preferred role (ROK-394).
 * Returns discordServerInviteUrl for PUG users who may need to join the server.
 */
export async function claimInviteCode(
    code: string,
    role?: 'tank' | 'healer' | 'dps',
): Promise<{
    type: 'signup' | 'claimed';
    eventId: number;
    discordServerInviteUrl?: string;
}> {
    return fetchApi(`/invite/${code}/claim`, {
        method: 'POST',
        body: JSON.stringify(role ? { role } : {}),
    });
}

/**
 * Share an event to bound Discord channels.
 */
export async function shareEventToDiscord(
    eventId: number,
): Promise<ShareEventResponseDto> {
    return fetchApi(`/events/${eventId}/share`, { method: 'POST' });
}

/**
 * Regenerate invite code for a PUG slot.
 */
export async function regeneratePugInviteCode(
    eventId: number,
    pugId: string,
): Promise<PugSlotResponseDto> {
    return fetchApi(`/events/${eventId}/pugs/${pugId}/regenerate-code`, {
        method: 'POST',
    });
}

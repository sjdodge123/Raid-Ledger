import type {
    UserProfileDto,
    PlayersListResponseDto,
    RecentPlayersResponseDto,
    UserHeartedGamesResponseDto,
    UserEventSignupsResponseDto,
    ActivityPeriod,
    UserActivityResponseDto,
    UserManagementListResponseDto,
    UserRole,
} from '@raid-ledger/contract';
import { fetchApi } from './fetch-api';

/** Fetch paginated player list (public) */
export async function getPlayers(params?: {
    page?: number;
    search?: string;
    gameId?: number;
}): Promise<PlayersListResponseDto> {
    const sp = new URLSearchParams();
    if (params?.page) sp.set('page', String(params.page));
    if (params?.search) sp.set('search', params.search);
    if (params?.gameId) sp.set('gameId', String(params.gameId));
    const query = sp.toString();
    return fetchApi(`/users${query ? `?${query}` : ''}`);
}

/** Fetch recently joined players (ROK-298) */
export async function getRecentPlayers(): Promise<RecentPlayersResponseDto> {
    return fetchApi('/users/recent');
}

/** Fetch a user's public profile by ID */
export async function getUserProfile(
    userId: number,
): Promise<UserProfileDto> {
    const response = await fetchApi<{ data: UserProfileDto }>(
        `/users/${userId}/profile`,
    );
    return response.data;
}

/** Fetch games a user has hearted, paginated (ROK-282, ROK-754) */
export async function getUserHeartedGames(
    userId: number,
    page = 1,
    limit = 20,
): Promise<UserHeartedGamesResponseDto> {
    return fetchApi(`/users/${userId}/hearted-games?page=${page}&limit=${limit}`);
}

/** Fetch a user's Steam library, paginated (ROK-754) */
export async function getUserSteamLibrary(
    userId: number,
    page = 1,
    limit = 20,
): Promise<import('@raid-ledger/contract').SteamLibraryResponseDto> {
    return fetchApi(`/users/${userId}/steam-library?page=${page}&limit=${limit}`);
}

/** Fetch upcoming events a user has signed up for (ROK-299) */
export async function getUserEventSignups(
    userId: number,
): Promise<UserEventSignupsResponseDto> {
    return fetchApi(`/users/${userId}/events/signups`);
}

/** Fetch a user's game activity (ROK-443) */
export async function getUserActivity(
    userId: number,
    period: ActivityPeriod,
): Promise<UserActivityResponseDto> {
    return fetchApi(`/users/${userId}/activity?period=${period}`);
}

/** Fetch paginated list of users with role info (admin-only, ROK-272) */
export async function getUsersForManagement(params?: {
    page?: number;
    limit?: number;
    search?: string;
}): Promise<UserManagementListResponseDto> {
    const sp = new URLSearchParams();
    if (params?.page) sp.set('page', String(params.page));
    if (params?.limit) sp.set('limit', String(params.limit));
    if (params?.search) sp.set('search', params.search);
    const query = sp.toString();
    return fetchApi(`/users/management${query ? `?${query}` : ''}`);
}

/** Update a user's role (admin-only) */
export async function updateUserRole(
    userId: number,
    role: Exclude<UserRole, 'admin'>,
): Promise<{
    data: { id: number; username: string; role: UserRole };
}> {
    return fetchApi(`/users/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
    });
}

/** Self-delete current user's account (ROK-405) */
export async function deleteMyAccount(
    confirmName: string,
): Promise<void> {
    return fetchApi('/users/me', {
        method: 'DELETE',
        body: JSON.stringify({ confirmName }),
    });
}

/** Admin-remove a user (ROK-405) */
export async function adminRemoveUser(
    userId: number,
): Promise<void> {
    return fetchApi(`/users/${userId}`, { method: 'DELETE' });
}

/** Unlink Discord from current user's account (ROK-195) */
export async function unlinkDiscord(): Promise<void> {
    return fetchApi('/users/me/discord', { method: 'DELETE' });
}

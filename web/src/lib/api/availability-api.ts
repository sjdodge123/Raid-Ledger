import type {
    AvailabilityListResponseDto,
    AvailabilityWithConflicts,
    CreateAvailabilityInput,
    UpdateAvailabilityDto,
} from '@raid-ledger/contract';
import { fetchApi } from './fetch-api';

export interface AvailabilityQueryParams {
    from?: string;
    to?: string;
    gameId?: string;
}

/** Fetch current user's availability windows */
export async function getMyAvailability(
    options?: AvailabilityQueryParams,
): Promise<AvailabilityListResponseDto> {
    const params = new URLSearchParams();
    if (options?.from) params.set('from', options.from);
    if (options?.to) params.set('to', options.to);
    if (options?.gameId) params.set('gameId', options.gameId);
    const query = params.toString();
    return fetchApi(
        `/users/me/availability${query ? `?${query}` : ''}`,
    );
}

/** Create a new availability window */
export async function createAvailability(
    dto: CreateAvailabilityInput,
): Promise<AvailabilityWithConflicts> {
    return fetchApi('/users/me/availability', {
        method: 'POST',
        body: JSON.stringify(dto),
    });
}

/** Update an existing availability window */
export async function updateAvailability(
    id: string,
    dto: UpdateAvailabilityDto,
): Promise<AvailabilityWithConflicts> {
    return fetchApi(`/users/me/availability/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(dto),
    });
}

/** Delete an availability window */
export async function deleteAvailability(
    id: string,
): Promise<void> {
    return fetchApi(`/users/me/availability/${id}`, {
        method: 'DELETE',
    });
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
    AvailabilityDto,
    AvailabilityListResponseDto,
    AvailabilityWithConflicts,
    CreateAvailabilityInput,
    UpdateAvailabilityDto,
} from '@raid-ledger/contract';
import { apiClient } from '../lib/api-client';

const AVAILABILITY_QUERY_KEY = ['availability'];

/**
 * Fetch current user's availability windows.
 */
export function useAvailability(options?: {
    from?: string;
    to?: string;
    gameId?: string;
    enabled?: boolean;
}) {
    const params = new URLSearchParams();
    if (options?.from) params.set('from', options.from);
    if (options?.to) params.set('to', options.to);
    if (options?.gameId) params.set('gameId', options.gameId);

    const queryString = params.toString();
    const url = `/users/me/availability${queryString ? `?${queryString}` : ''}`;

    return useQuery<AvailabilityListResponseDto>({
        queryKey: [...AVAILABILITY_QUERY_KEY, options],
        queryFn: async () => {
            const response = await apiClient.get(url);
            return response.data;
        },
        enabled: options?.enabled ?? true,
    });
}

/**
 * Create a new availability window.
 */
export function useCreateAvailability() {
    const queryClient = useQueryClient();

    return useMutation<AvailabilityWithConflicts, Error, CreateAvailabilityInput>({
        mutationFn: async (data) => {
            const response = await apiClient.post('/users/me/availability', data);
            return response.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: AVAILABILITY_QUERY_KEY });
        },
    });
}

/**
 * Update an existing availability window.
 */
export function useUpdateAvailability() {
    const queryClient = useQueryClient();

    return useMutation<
        AvailabilityWithConflicts,
        Error,
        { id: string; data: UpdateAvailabilityDto }
    >({
        mutationFn: async ({ id, data }) => {
            const response = await apiClient.patch(`/users/me/availability/${id}`, data);
            return response.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: AVAILABILITY_QUERY_KEY });
        },
    });
}

/**
 * Delete an availability window.
 */
export function useDeleteAvailability() {
    const queryClient = useQueryClient();

    return useMutation<void, Error, string>({
        mutationFn: async (id) => {
            await apiClient.delete(`/users/me/availability/${id}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: AVAILABILITY_QUERY_KEY });
        },
    });
}

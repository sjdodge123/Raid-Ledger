import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreateAvailabilityInput, UpdateAvailabilityDto } from '@raid-ledger/contract';
import {
    getMyAvailability,
    createAvailability,
    updateAvailability,
    deleteAvailability,
    type AvailabilityQueryParams,
} from '../lib/api-client';

const AVAILABILITY_QUERY_KEY = ['me', 'availability'];

/**
 * Fetch current user's availability windows.
 */
export function useAvailability(options?: AvailabilityQueryParams & { enabled?: boolean }) {
    const { enabled, ...queryOptions } = options ?? {};
    return useQuery({
        queryKey: [...AVAILABILITY_QUERY_KEY, queryOptions],
        queryFn: () => getMyAvailability(queryOptions),
        enabled: enabled ?? true,
    });
}

/**
 * Create a new availability window.
 */
export function useCreateAvailability() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (data: CreateAvailabilityInput) => createAvailability(data),
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

    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: UpdateAvailabilityDto }) =>
            updateAvailability(id, data),
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

    return useMutation({
        mutationFn: (id: string) => deleteAvailability(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: AVAILABILITY_QUERY_KEY });
        },
    });
}

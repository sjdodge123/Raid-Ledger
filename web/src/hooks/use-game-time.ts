import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { GameTimeTemplateInput } from '@raid-ledger/contract';
import { getMyGameTime, saveMyGameTime, saveMyGameTimeOverrides, createGameTimeAbsence, deleteGameTimeAbsence } from '../lib/api-client';

export const GAME_TIME_QUERY_KEY = ['me', 'game-time'];

/**
 * Fetch current user's game time (composite view: template + event commitments).
 */
export function useGameTime(options?: { enabled?: boolean; week?: string }) {
    return useQuery({
        queryKey: [...GAME_TIME_QUERY_KEY, options?.week ?? 'current'],
        queryFn: () => getMyGameTime(options?.week),
        enabled: options?.enabled ?? true,
        staleTime: 0,
        refetchOnMount: 'always',
    });
}

/**
 * Save current user's game time template.
 * Invalidates the query on success to re-fetch the composite view.
 */
export function useSaveGameTime() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (slots: GameTimeTemplateInput['slots']) => saveMyGameTime(slots),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: GAME_TIME_QUERY_KEY });
        },
    });
}

/**
 * Save per-hour date-specific overrides.
 */
export function useSaveGameTimeOverrides() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (overrides: Array<{ date: string; hour: number; status: string }>) =>
            saveMyGameTimeOverrides(overrides),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: GAME_TIME_QUERY_KEY });
        },
    });
}

/**
 * Create an absence range.
 */
export function useCreateAbsence() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: { startDate: string; endDate: string; reason?: string }) =>
            createGameTimeAbsence(input),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: GAME_TIME_QUERY_KEY });
        },
    });
}

/**
 * Delete an absence.
 */
export function useDeleteAbsence() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: number) => deleteGameTimeAbsence(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: GAME_TIME_QUERY_KEY });
        },
    });
}

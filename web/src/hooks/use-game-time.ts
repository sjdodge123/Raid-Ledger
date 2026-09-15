import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { GameTimeTemplateInput } from '@raid-ledger/contract';
import { getMyGameTime, saveMyGameTime, saveMyGameTimeOverrides, confirmMyGameTime, createGameTimeAbsence, deleteGameTimeAbsence, getGameTimeAbsences } from '../lib/api-client';

export const GAME_TIME_QUERY_KEY = ['me', 'game-time'];
export const GAME_TIME_ABSENCES_KEY = ['me', 'game-time', 'absences-all'];

/**
 * Fetch current user's game time (composite view: template + event commitments).
 */
export function useGameTime(options?: { enabled?: boolean; week?: string; tzOffset?: number }) {
    return useQuery({
        queryKey: [...GAME_TIME_QUERY_KEY, options?.week ?? 'current', options?.tzOffset],
        queryFn: () => getMyGameTime(options?.week, options?.tzOffset),
        enabled: options?.enabled ?? true,
        staleTime: 30_000,
    });
}

/**
 * Save current user's game time template.
 * Invalidates the query on success to re-fetch the composite view — and
 * ['scheduling'] too: a saved week is a confirmed week (the server stamps it),
 * so a poll page's group heatmap and the viewer's freshness change with it
 * (ROK-1569 — the phone check saves from the poll page itself).
 */
export function useSaveGameTime() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (slots: GameTimeTemplateInput['slots']) => saveMyGameTime(slots),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: GAME_TIME_QUERY_KEY });
            queryClient.invalidateQueries({ queryKey: ['scheduling'] });
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
 * Confirm the saved game time without editing it (ROK-1564).
 *
 * The "Looks right" answer to the poll page's game-time check. Invalidates the
 * game-time query (so `gameTimeStale` clears and the overlay closes itself) and
 * ['scheduling'] (so the group heatmap on the same page redraws the viewer as
 * fresh).
 */
export function useConfirmGameTime() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: () => confirmMyGameTime(),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: GAME_TIME_QUERY_KEY });
            queryClient.invalidateQueries({ queryKey: ['scheduling'] });
        },
    });
}

/**
 * Fetch ALL absences regardless of week (ROK-998).
 * Sorted by startDate ascending.
 */
export function useGameTimeAbsences(options?: { enabled?: boolean }) {
    return useQuery({
        queryKey: GAME_TIME_ABSENCES_KEY,
        queryFn: getGameTimeAbsences,
        enabled: options?.enabled ?? true,
        staleTime: 30_000,
    });
}

/**
 * Create an absence range.
 *
 * ROK-1564: the server ALSO stamps `game_time_confirmed_at` on create, so this
 * invalidates ['scheduling'] as well — the poll page's heatmap and the viewer's
 * freshness both change as a result of the same write.
 */
export function useCreateAbsence() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: { startDate: string; endDate: string; reason?: string }) =>
            createGameTimeAbsence(input),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: GAME_TIME_QUERY_KEY });
            queryClient.invalidateQueries({ queryKey: GAME_TIME_ABSENCES_KEY });
            queryClient.invalidateQueries({ queryKey: ['scheduling'] });
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
            queryClient.invalidateQueries({ queryKey: GAME_TIME_ABSENCES_KEY });
        },
    });
}

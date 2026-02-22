import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '../lib/toast';
import type { CreateEventPlanDto } from '@raid-ledger/contract';
import {
    getTimeSuggestions,
    createEventPlan,
    getMyEventPlans,
    getEventPlan,
    cancelEventPlan,
    getEventPlanPollResults,
    restartEventPlan,
    convertEventToPlan,
} from '../lib/api-client';

/**
 * Fetch smart time suggestions for a game.
 */
export function useTimeSuggestions(params?: {
    gameId?: number;
    tzOffset?: number;
    afterDate?: string;
}) {
    return useQuery({
        queryKey: ['time-suggestions', params?.gameId, params?.afterDate],
        queryFn: () => getTimeSuggestions(params),
        enabled: true,
    });
}

/**
 * Create an event plan (posts Discord poll).
 */
export function useCreateEventPlan() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (dto: CreateEventPlanDto) => createEventPlan(dto),
        onSuccess: () => {
            toast.success('Event plan created! Poll posted to Discord.');
            queryClient.invalidateQueries({ queryKey: ['event-plans'] });
        },
        onError: (error: Error) => {
            toast.error(error.message || 'Failed to create event plan');
        },
    });
}

/**
 * Fetch current user's event plans.
 * Auto-refreshes every 30s to keep plan statuses current.
 */
export function useMyEventPlans() {
    return useQuery({
        queryKey: ['event-plans', 'my-plans'],
        queryFn: getMyEventPlans,
        refetchInterval: 30_000,
    });
}

/**
 * Fetch a single event plan.
 */
export function useEventPlan(planId: string | undefined) {
    return useQuery({
        queryKey: ['event-plans', planId],
        queryFn: () => getEventPlan(planId!),
        enabled: !!planId,
    });
}

/**
 * Cancel an active event plan.
 */
export function useCancelEventPlan() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (planId: string) => cancelEventPlan(planId),
        onSuccess: () => {
            toast.success('Event plan cancelled');
            queryClient.invalidateQueries({ queryKey: ['event-plans'] });
        },
        onError: (error: Error) => {
            toast.error(error.message || 'Failed to cancel event plan');
        },
    });
}

/**
 * Fetch poll results for an active plan (auto-refreshes every 30s).
 */
export function useEventPlanPollResults(planId: string | undefined, enabled: boolean) {
    return useQuery({
        queryKey: ['event-plans', planId, 'poll-results'],
        queryFn: () => getEventPlanPollResults(planId!),
        enabled: !!planId && enabled,
        refetchInterval: 30_000,
    });
}

/**
 * Restart a cancelled or expired event plan.
 */
export function useRestartEventPlan() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (planId: string) => restartEventPlan(planId),
        onSuccess: () => {
            toast.success('Poll restarted!');
            queryClient.invalidateQueries({ queryKey: ['event-plans'] });
        },
        onError: (error: Error) => {
            toast.error(error.message || 'Failed to restart poll');
        },
    });
}

/**
 * Convert an existing event to a plan (poll-based scheduling).
 */
export function useConvertEventToPlan() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ eventId, options }: {
            eventId: number;
            options?: { cancelOriginal?: boolean; pollDurationHours?: number };
        }) => convertEventToPlan(eventId, options),
        onSuccess: () => {
            toast.success('Event converted to plan! Poll posted to Discord.');
            queryClient.invalidateQueries({ queryKey: ['event-plans'] });
            queryClient.invalidateQueries({ queryKey: ['events'] });
        },
        onError: (error: Error) => {
            toast.error(error.message || 'Failed to convert event to plan');
        },
    });
}

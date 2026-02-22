import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '../lib/toast';
import type { CreateEventPlanDto } from '@raid-ledger/contract';
import {
    getTimeSuggestions,
    createEventPlan,
    getMyEventPlans,
    getEventPlan,
    cancelEventPlan,
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
 */
export function useMyEventPlans() {
    return useQuery({
        queryKey: ['event-plans', 'my-plans'],
        queryFn: getMyEventPlans,
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

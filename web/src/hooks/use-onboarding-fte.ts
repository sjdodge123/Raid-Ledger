import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '../lib/api-client';
import { useDebouncedValue } from './use-debounced-value';
import type { User } from './use-auth';
import type {
    CheckDisplayNameResponseDto,
    CompleteOnboardingResponseDto,
} from '@raid-ledger/contract';

/**
 * Hook for checking display name availability with debounce.
 * ROK-219: Used in Step 1 of the FTE wizard.
 */
export function useCheckDisplayName(name: string) {
    const debouncedName = useDebouncedValue(name, 500);

    return useQuery<CheckDisplayNameResponseDto>({
        queryKey: ['users', 'check-display-name', debouncedName],
        queryFn: () =>
            fetchApi<CheckDisplayNameResponseDto>(
                `/users/check-display-name?name=${encodeURIComponent(debouncedName)}`,
            ),
        enabled: debouncedName.length >= 2,
        staleTime: 1000 * 30,
    });
}

/**
 * Hook for updating user profile (display name).
 * ROK-219: Used in Step 1 of the FTE wizard.
 */
export function useUpdateUserProfile() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (displayName: string) =>
            fetchApi('/users/me', {
                method: 'PATCH',
                body: JSON.stringify({ displayName }),
            }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
        },
    });
}

/**
 * Hook for completing FTE onboarding.
 * ROK-219: Used in the final step of the FTE wizard.
 *
 * TDB:982: the cached auth/me user is patched with the response's
 * `onboardingCompletedAt` synchronously, before any per-call `onSuccess`
 * runs. The wizard navigates away in that callback, and AuthGuard reads the
 * cache — a stale (not-completed) user bounced it straight back to
 * /onboarding. The invalidation still runs to reconcile with the server.
 * The patch also makes the wizard's own completed-user redirect true, so the
 * wizard skips that redirect while this mutation is pending or succeeded —
 * otherwise it could replace the per-call invite-claim navigate.
 */
export function useCompleteOnboardingFte() {
    const queryClient = useQueryClient();

    return useMutation<CompleteOnboardingResponseDto>({
        mutationFn: () =>
            fetchApi<CompleteOnboardingResponseDto>('/users/me/complete-onboarding', {
                method: 'POST',
            }),
        onSuccess: (data) => {
            queryClient.setQueryData<User | null>(['auth', 'me'], (prev) =>
                prev ? { ...prev, onboardingCompletedAt: data.onboardingCompletedAt } : prev,
            );
            void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
        },
    });
}

/**
 * Hook for resetting onboarding to allow wizard re-run from settings.
 * ROK-219: Calls POST /users/me/reset-onboarding.
 */
export function useResetOnboarding() {
    const queryClient = useQueryClient();

    return useMutation<{ success: boolean }>({
        mutationFn: () =>
            fetchApi<{ success: boolean }>('/users/me/reset-onboarding', {
                method: 'POST',
            }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
        },
    });
}

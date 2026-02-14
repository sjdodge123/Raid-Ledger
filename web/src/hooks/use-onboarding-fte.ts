import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '../lib/api-client';
import { useDebouncedValue } from './use-debounced-value';
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
 */
export function useCompleteOnboardingFte() {
    const queryClient = useQueryClient();

    return useMutation<CompleteOnboardingResponseDto>({
        mutationFn: () =>
            fetchApi<CompleteOnboardingResponseDto>('/users/me/complete-onboarding', {
                method: 'POST',
            }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
        },
    });
}

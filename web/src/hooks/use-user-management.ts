import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getUsersForManagement, updateUserRole } from '../lib/api-client';
import type { UserRole } from '@raid-ledger/contract';

/**
 * Hook for the admin Role Management Panel (ROK-272).
 * Fetches paginated user list and provides role update mutation.
 */
export function useUserManagement(params?: {
    page?: number;
    search?: string;
}) {
    const queryClient = useQueryClient();

    const users = useQuery({
        queryKey: ['user-management', params?.page ?? 1, params?.search ?? ''],
        queryFn: () =>
            getUsersForManagement({
                page: params?.page ?? 1,
                limit: 20,
                search: params?.search || undefined,
            }),
    });

    const updateRole = useMutation({
        mutationFn: ({
            userId,
            role,
        }: {
            userId: number;
            role: Exclude<UserRole, 'admin'>;
        }) => updateUserRole(userId, role),
        onSuccess: () => {
            // Invalidate user management list to refetch with updated roles
            queryClient.invalidateQueries({ queryKey: ['user-management'] });
        },
    });

    return { users, updateRole };
}

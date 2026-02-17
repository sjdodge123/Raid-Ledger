import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getUsersForManagement, updateUserRole } from '../lib/api-client';
import type { UserRole, UserManagementDto } from '@raid-ledger/contract';
import { useInfiniteList } from './use-infinite-list';

/**
 * Hook for the admin Role Management Panel (ROK-272).
 * Fetches infinite-scroll user list and provides role update mutation.
 */
export function useUserManagement(params?: {
    search?: string;
}) {
    const queryClient = useQueryClient();

    const users = useInfiniteList<UserManagementDto>({
        queryKey: ['user-management', params?.search ?? ''],
        queryFn: (page) =>
            getUsersForManagement({
                page,
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

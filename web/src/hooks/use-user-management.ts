import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getUsersForManagement, updateUserRole, adminRemoveUser } from '../lib/api-client';
import type { UserRole, UserManagementDto } from '@raid-ledger/contract';
import { useInfiniteList } from './use-infinite-list';

/**
 * Hook for the admin Role Management Panel (ROK-272, ROK-405).
 * Fetches infinite-scroll user list and provides role update + removal mutations.
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
            queryClient.invalidateQueries({ queryKey: ['user-management'] });
        },
    });

    const removeUser = useMutation({
        mutationFn: (userId: number) => adminRemoveUser(userId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['user-management'] });
        },
    });

    return { users, updateRole, removeUser };
}

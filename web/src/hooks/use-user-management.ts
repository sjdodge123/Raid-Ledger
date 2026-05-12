import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getUsersForManagement, updateUserRole, adminRemoveUser, adminReactivateUser } from '../lib/api-client';
import type { UserRole, UserManagementDto } from '@raid-ledger/contract';
import { useInfiniteList } from './use-infinite-list';

/**
 * Hook for the admin Role Management Panel (ROK-272, ROK-405, ROK-1260).
 * Fetches infinite-scroll user list and provides role update, removal, and reactivate mutations.
 */
function useRoleMutation(queryClient: ReturnType<typeof useQueryClient>) {
    return useMutation({
        mutationFn: ({ userId, role }: { userId: number; role: Exclude<UserRole, 'admin'> }) => updateUserRole(userId, role),
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['user-management'] }); },
    });
}

function useRemoveMutation(queryClient: ReturnType<typeof useQueryClient>) {
    return useMutation({
        mutationFn: (userId: number) => adminRemoveUser(userId),
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['user-management'] }); },
    });
}

function useReactivateMutation(queryClient: ReturnType<typeof useQueryClient>) {
    return useMutation({
        mutationFn: (userId: number) => adminReactivateUser(userId),
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['user-management'] }); },
    });
}

export function useUserManagement(params?: { search?: string }) {
    const queryClient = useQueryClient();
    const users = useInfiniteList<UserManagementDto>({
        queryKey: ['user-management', params?.search ?? ''],
        queryFn: (page) => getUsersForManagement({ page, limit: 20, search: params?.search || undefined }),
    });

    return {
        users,
        updateRole: useRoleMutation(queryClient),
        removeUser: useRemoveMutation(queryClient),
        reactivateUser: useReactivateMutation(queryClient),
    };
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
    getUsersForManagement, updateUserRole, adminRemoveUser, adminReactivateUser,
    adminKickUser, adminUnkickUser, adminBanUser, adminUnbanUser,
} from '../lib/api-client';
import type { UserRole, UserManagementDto, KickUserDto, BanUserDto } from '@raid-ledger/contract';
import { useInfiniteList } from './use-infinite-list';

type QueryClient = ReturnType<typeof useQueryClient>;

/**
 * Generic mutation factory for user-management actions (ROK-313): runs `fn`,
 * then invalidates the ['user-management'] list so the affected row reflects
 * its new state. Toasts stay in the calling component's handlers.
 */
function useUserActionMutation<TVars>(queryClient: QueryClient, fn: (vars: TVars) => Promise<unknown>) {
    return useMutation({
        mutationFn: fn,
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['user-management'] }); },
    });
}

/**
 * Hook for the admin Role Management Panel (ROK-272, ROK-405, ROK-1260, ROK-313).
 * Fetches the infinite-scroll user list and provides role / remove / reactivate /
 * kick / unkick / ban / unban mutations.
 */
export function useUserManagement(params?: { search?: string }) {
    const queryClient = useQueryClient();
    const users = useInfiniteList<UserManagementDto>({
        queryKey: ['user-management', params?.search ?? ''],
        queryFn: (page) => getUsersForManagement({ page, limit: 20, search: params?.search || undefined }),
    });

    return {
        users,
        updateRole: useUserActionMutation(queryClient,
            ({ userId, role }: { userId: number; role: Exclude<UserRole, 'admin'> }) => updateUserRole(userId, role)),
        removeUser: useUserActionMutation(queryClient, (userId: number) => adminRemoveUser(userId)),
        reactivateUser: useUserActionMutation(queryClient, (userId: number) => adminReactivateUser(userId)),
        kickUser: useUserActionMutation(queryClient,
            ({ userId, body }: { userId: number; body: KickUserDto }) => adminKickUser(userId, body)),
        unkickUser: useUserActionMutation(queryClient, (userId: number) => adminUnkickUser(userId)),
        banUser: useUserActionMutation(queryClient,
            ({ userId, body }: { userId: number; body: BanUserDto }) => adminBanUser(userId, body)),
        unbanUser: useUserActionMutation(queryClient, (userId: number) => adminUnbanUser(userId)),
    };
}

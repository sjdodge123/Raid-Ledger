import { useQuery } from '@tanstack/react-query';
import { getUserProfile } from '../lib/api-client';
import type { UserProfileDto } from '@raid-ledger/contract';

/**
 * Fetch a user's public profile by ID (ROK-181).
 */
export function useUserProfile(userId: number | undefined) {
    return useQuery<UserProfileDto>({
        queryKey: ['userProfile', userId],
        queryFn: async () => {
            if (!userId) throw new Error('User ID required');
            return getUserProfile(userId);
        },
        enabled: !!userId,
        staleTime: 5 * 60 * 1000, // 5 minutes
    });
}


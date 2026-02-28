import { useQuery } from '@tanstack/react-query';
import { getUserProfile, getUserHeartedGames, getUserEventSignups, getUserActivity } from '../lib/api-client';
import type { UserProfileDto, UserHeartedGamesResponseDto, UserEventSignupsResponseDto, ActivityPeriod, UserActivityResponseDto } from '@raid-ledger/contract';

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

/**
 * ROK-282: Fetch games a user has hearted.
 */
export function useUserHeartedGames(userId: number | undefined) {
    return useQuery<UserHeartedGamesResponseDto>({
        queryKey: ['userHeartedGames', userId],
        queryFn: async () => {
            if (!userId) throw new Error('User ID required');
            return getUserHeartedGames(userId);
        },
        enabled: !!userId,
        staleTime: 5 * 60 * 1000,
    });
}

/**
 * ROK-299: Fetch upcoming events a user has signed up for.
 */
export function useUserEventSignups(userId: number | undefined) {
    return useQuery<UserEventSignupsResponseDto>({
        queryKey: ['userEventSignups', userId],
        queryFn: async () => {
            if (!userId) throw new Error('User ID required');
            return getUserEventSignups(userId);
        },
        enabled: !!userId,
        staleTime: 5 * 60 * 1000,
    });
}

/**
 * ROK-443: Fetch a user's game activity (recently played games).
 */
export function useUserActivity(userId: number | undefined, period: ActivityPeriod) {
    return useQuery<UserActivityResponseDto>({
        queryKey: ['userActivity', userId, period],
        queryFn: async () => {
            if (!userId) throw new Error('User ID required');
            return getUserActivity(userId, period);
        },
        enabled: !!userId,
        staleTime: 5 * 60 * 1000,
    });
}


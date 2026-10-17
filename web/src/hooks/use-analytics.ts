import { useQuery } from '@tanstack/react-query';
import {
    getAttendanceTrends,
    getUserReliability,
    getGameAttendance,
    getEventMetrics,
} from '../lib/api-client';
import type { AttendanceTrendsPeriod } from '@raid-ledger/contract';

/**
 * Hook for community-wide attendance trend data (ROK-491).
 * Operator/admin only.
 */
export function useAttendanceTrends(period: AttendanceTrendsPeriod = '30d') {
    return useQuery({
        queryKey: ['analytics', 'attendance-trends', period],
        queryFn: () => getAttendanceTrends(period),
    });
}

/**
 * Hook for per-user reliability leaderboard (ROK-491).
 * Operator/admin only.
 */
export function useUserReliability(limit = 20, offset = 0) {
    return useQuery({
        queryKey: ['analytics', 'user-reliability', limit, offset],
        queryFn: () => getUserReliability(limit, offset),
    });
}

/**
 * Hook for per-game attendance breakdown (ROK-491).
 * Operator/admin only.
 */
export function useGameAttendance() {
    return useQuery({
        queryKey: ['analytics', 'game-attendance'],
        queryFn: () => getGameAttendance(),
    });
}

/**
 * Hook for per-event metrics with voice data (ROK-491).
 * Any authenticated user.
 */
export function useEventMetrics(eventId: number) {
    return useQuery({
        queryKey: ['events', eventId, 'metrics'],
        queryFn: () => getEventMetrics(eventId),
        enabled: eventId > 0,
    });
}

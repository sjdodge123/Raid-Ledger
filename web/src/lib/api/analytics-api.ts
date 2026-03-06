import type {
    AttendanceTrendsPeriod,
    AttendanceTrendsResponseDto,
    UserReliabilityResponseDto,
    GameAttendanceResponseDto,
    EventMetricsResponseDto,
} from '@raid-ledger/contract';
import { fetchApi } from './fetch-api';

/** Get community-wide attendance trends (operator/admin only) */
export async function getAttendanceTrends(
    period: AttendanceTrendsPeriod = '30d',
): Promise<AttendanceTrendsResponseDto> {
    return fetchApi(`/analytics/attendance?period=${period}`);
}

/** Get per-user reliability stats (operator/admin only) */
export async function getUserReliability(
    limit = 20,
    offset = 0,
): Promise<UserReliabilityResponseDto> {
    return fetchApi(
        `/analytics/attendance/users?limit=${limit}&offset=${offset}`,
    );
}

/** Get per-game attendance breakdown (operator/admin only) */
export async function getGameAttendance(): Promise<GameAttendanceResponseDto> {
    return fetchApi('/analytics/attendance/games');
}

/** Get per-event metrics with attendance and voice data */
export async function getEventMetrics(
    eventId: number,
): Promise<EventMetricsResponseDto> {
    return fetchApi(`/events/${eventId}/metrics`);
}

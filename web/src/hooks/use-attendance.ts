import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAttendanceSummary, recordAttendance } from '../lib/api-client';
import type { AttendanceStatus } from '@raid-ledger/contract';

/**
 * Hook for fetching attendance summary for a past event (ROK-421).
 */
export function useAttendanceSummary(eventId: number, enabled = true) {
    return useQuery({
        queryKey: ['events', eventId, 'attendance'],
        queryFn: () => getAttendanceSummary(eventId),
        enabled,
    });
}

/**
 * Hook for recording attendance on a single signup (ROK-421).
 */
export function useRecordAttendance(eventId: number) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({
            signupId,
            attendanceStatus,
        }: {
            signupId: number;
            attendanceStatus: AttendanceStatus;
        }) => recordAttendance(eventId, signupId, attendanceStatus),
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: ['events', eventId, 'attendance'],
            });
            queryClient.invalidateQueries({
                queryKey: ['events', eventId, 'roster'],
            });
        },
    });
}

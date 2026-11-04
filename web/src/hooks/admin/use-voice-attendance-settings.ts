import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { VoiceAttendanceSettingsDto } from '@raid-ledger/contract';
import { getAuthToken } from '../use-auth';
import { adminFetch } from './admin-fetch';

/** ROK-1940: admin voice-attendance grace (minutes) query + update mutation. */

const VOICE_ATTENDANCE_KEY = ['admin', 'settings', 'voice-attendance'] as const;
const PATH = '/admin/settings/voice-attendance';

function useVoiceAttendanceQuery() {
    return useQuery<VoiceAttendanceSettingsDto>({
        queryKey: [...VOICE_ATTENDANCE_KEY],
        queryFn: () => adminFetch(PATH),
        enabled: !!getAuthToken(),
        staleTime: 30_000,
    });
}

function useVoiceAttendanceMutation() {
    const queryClient = useQueryClient();
    return useMutation<VoiceAttendanceSettingsDto, Error, number>({
        mutationFn: (graceMinutes) =>
            adminFetch(
                PATH,
                { method: 'PUT', body: JSON.stringify({ graceMinutes }) },
                'Failed to save voice attendance grace',
            ),
        onSuccess: (saved) => queryClient.setQueryData([...VOICE_ATTENDANCE_KEY], saved),
    });
}

/** Voice-attendance settings query + update mutation. */
export function useVoiceAttendanceSettings() {
    return {
        voiceAttendance: useVoiceAttendanceQuery(),
        updateVoiceAttendance: useVoiceAttendanceMutation(),
    };
}

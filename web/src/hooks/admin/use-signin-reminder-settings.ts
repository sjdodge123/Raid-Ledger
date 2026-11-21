import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { SigninReminderSettingsDto } from '@raid-ledger/contract';
import { getAuthToken } from '../use-auth';
import { adminFetch } from './admin-fetch';

/** ROK-2284: admin sign-in reminder DM settings (switch, weeks, max). */

const SIGNIN_REMINDER_KEY = ['admin', 'settings', 'signin-reminder'] as const;
const PATH = '/admin/settings/signin-reminder';

function useSigninReminderQuery() {
    return useQuery<SigninReminderSettingsDto>({
        queryKey: [...SIGNIN_REMINDER_KEY],
        queryFn: () => adminFetch(PATH),
        enabled: !!getAuthToken(),
        staleTime: 30_000,
    });
}

function useSigninReminderMutation() {
    const queryClient = useQueryClient();
    return useMutation<SigninReminderSettingsDto, Error, SigninReminderSettingsDto>({
        mutationFn: (settings) =>
            adminFetch(
                PATH,
                { method: 'PUT', body: JSON.stringify(settings) },
                'Failed to save sign-in reminder settings',
            ),
        onSuccess: (saved) => queryClient.setQueryData([...SIGNIN_REMINDER_KEY], saved),
    });
}

/** Sign-in reminder settings query + update mutation (PUT sends all three). */
export function useSigninReminderSettings() {
    return {
        signinReminder: useSigninReminderQuery(),
        updateSigninReminder: useSigninReminderMutation(),
    };
}

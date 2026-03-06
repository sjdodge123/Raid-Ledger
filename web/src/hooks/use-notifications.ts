import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '../lib/toast';
import {
    fetchNotifications,
    fetchUnreadCount,
    markNotificationRead,
    markAllNotificationsRead,
    fetchPreferences,
    patchPreferences,
    fetchChannelAvailability,
} from './notifications-api';

export interface Notification {
    id: string;
    userId: number;
    type: string;
    title: string;
    message: string;
    payload?: Record<string, unknown>;
    readAt?: string;
    createdAt: string;
    expiresAt?: string;
}

export type NotificationType =
    | 'slot_vacated'
    | 'event_reminder'
    | 'new_event'
    | 'subscribed_game'
    | 'achievement_unlocked'
    | 'level_up'
    | 'missed_event_nudge'
    | 'event_rescheduled'
    | 'bench_promoted'
    | 'event_cancelled'
    | 'roster_reassigned'
    | 'tentative_displaced'
    | 'member_returned'
    | 'system';

export type Channel = 'inApp' | 'push' | 'discord';
export type ChannelPrefs = Record<
    NotificationType,
    Record<Channel, boolean>
>;

export interface NotificationPreferences {
    userId: number;
    channelPrefs: ChannelPrefs;
}

export interface UpdatePreferencesInput {
    channelPrefs: Partial<
        Record<NotificationType, Partial<Record<Channel, boolean>>>
    >;
}

export interface ChannelAvailability {
    discord: { available: boolean; reason?: string };
}

const NOTIFICATION_STALE_TIME = 30 * 1000;
const PREFERENCES_STALE_TIME = 5 * 60 * 1000;

/** Hook for managing notifications */
export function useNotifications(limit = 20, offset = 0) {
    const queryClient = useQueryClient();

    const {
        data: notifications = [],
        isLoading,
        error,
    } = useQuery({
        queryKey: ['notifications', limit, offset],
        queryFn: () => fetchNotifications(limit, offset),
        staleTime: NOTIFICATION_STALE_TIME,
    });

    const { data: unreadCount = 0 } = useQuery({
        queryKey: ['notifications', 'unread-count'],
        queryFn: fetchUnreadCount,
        staleTime: NOTIFICATION_STALE_TIME,
    });

    const markReadMutation = useMutation({
        mutationFn: markNotificationRead,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['notifications'] });
        },
    });

    const markAllReadMutation = useMutation({
        mutationFn: markAllNotificationsRead,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['notifications'] });
        },
    });

    return {
        notifications,
        unreadCount,
        isLoading,
        error,
        markRead: markReadMutation.mutate,
        markAllRead: markAllReadMutation.mutate,
    };
}

/** Hook for managing notification preferences with optimistic updates */
export function useNotificationPreferences() {
    const queryClient = useQueryClient();
    const queryKey = ['notifications', 'preferences'];

    const {
        data: preferences,
        isLoading,
        error,
    } = useQuery({
        queryKey,
        queryFn: fetchPreferences,
        staleTime: PREFERENCES_STALE_TIME,
    });

    const { data: channelAvailability } = useQuery({
        queryKey: ['notifications', 'channels'],
        queryFn: fetchChannelAvailability,
        staleTime: PREFERENCES_STALE_TIME,
    });

    const updateMutation = useMutation({
        mutationFn: patchPreferences,
        onMutate: async (input: UpdatePreferencesInput) => {
            await queryClient.cancelQueries({ queryKey });
            const previous =
                queryClient.getQueryData<NotificationPreferences>(queryKey);

            if (previous) {
                const optimistic: NotificationPreferences = {
                    ...previous,
                    channelPrefs: { ...previous.channelPrefs },
                };
                for (const [type, channels] of Object.entries(
                    input.channelPrefs,
                )) {
                    const t = type as NotificationType;
                    if (optimistic.channelPrefs[t] && channels) {
                        optimistic.channelPrefs[t] = {
                            ...optimistic.channelPrefs[t],
                            ...channels,
                        };
                    }
                }
                queryClient.setQueryData<NotificationPreferences>(
                    queryKey,
                    optimistic,
                );
            }
            return { previous };
        },
        onSuccess: () => {
            toast.success('Preferences updated', { id: 'notif-prefs' });
        },
        onError: (_err, _vars, context) => {
            if (
                (context as { previous?: NotificationPreferences })?.previous
            ) {
                queryClient.setQueryData(
                    queryKey,
                    (context as { previous: NotificationPreferences })
                        .previous,
                );
            }
            toast.error('Failed to update preferences', {
                id: 'notif-prefs',
            });
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey });
        },
    });

    return {
        preferences,
        isLoading,
        error,
        updatePreferences: updateMutation.mutate,
        channelAvailability,
    };
}

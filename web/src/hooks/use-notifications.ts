import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '../lib/toast';
import { API_BASE_URL } from '../lib/config';
import { getAuthToken } from './use-auth';

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
    | 'bench_promoted';

export type Channel = 'inApp' | 'push' | 'discord';

export type ChannelPrefs = Record<NotificationType, Record<Channel, boolean>>;

export interface NotificationPreferences {
    userId: number;
    channelPrefs: ChannelPrefs;
}

export interface UpdatePreferencesInput {
    channelPrefs: Partial<Record<NotificationType, Partial<Record<Channel, boolean>>>>;
}

/**
 * Fetch all notifications for the current user
 */
async function fetchNotifications(
    limit = 20,
    offset = 0,
): Promise<Notification[]> {
    const token = getAuthToken();
    if (!token) throw new Error('Not authenticated');

    const response = await fetch(
        `${API_BASE_URL}/notifications?limit=${limit}&offset=${offset}`,
        {
            headers: { Authorization: `Bearer ${token}` },
        },
    );

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
}

/**
 * Fetch unread notification count
 */
async function fetchUnreadCount(): Promise<number> {
    const token = getAuthToken();
    if (!token) return 0;

    const response = await fetch(`${API_BASE_URL}/notifications/unread/count`, {
        headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    return data.count;
}

/**
 * Mark a notification as read
 */
async function markNotificationRead(notificationId: string): Promise<void> {
    const token = getAuthToken();
    if (!token) throw new Error('Not authenticated');

    const response = await fetch(
        `${API_BASE_URL}/notifications/${notificationId}/read`,
        {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
        },
    );

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
}

/**
 * Mark all notifications as read
 */
async function markAllNotificationsRead(): Promise<void> {
    const token = getAuthToken();
    if (!token) throw new Error('Not authenticated');

    const response = await fetch(`${API_BASE_URL}/notifications/read-all`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
}

/**
 * Fetch notification preferences
 */
async function fetchPreferences(): Promise<NotificationPreferences> {
    const token = getAuthToken();
    if (!token) throw new Error('Not authenticated');

    const response = await fetch(`${API_BASE_URL}/notifications/preferences`, {
        headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
}

/**
 * Update notification preferences
 */
async function patchPreferences(
    input: UpdatePreferencesInput,
): Promise<NotificationPreferences> {
    const token = getAuthToken();
    if (!token) throw new Error('Not authenticated');

    const response = await fetch(`${API_BASE_URL}/notifications/preferences`, {
        method: 'PATCH',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
}

/**
 * Fetch notification channel availability (ROK-180 AC-7)
 */
export interface ChannelAvailability {
    discord: { available: boolean; reason?: string };
}

async function fetchChannelAvailability(): Promise<ChannelAvailability> {
    const token = getAuthToken();
    if (!token) return { discord: { available: false, reason: 'Not authenticated' } };

    const response = await fetch(`${API_BASE_URL}/notifications/channels`, {
        headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
        return { discord: { available: false } };
    }

    return response.json();
}

// Cache configuration
const NOTIFICATION_STALE_TIME = 30 * 1000; // 30 seconds
const PREFERENCES_STALE_TIME = 5 * 60 * 1000; // 5 minutes

/**
 * Hook for managing notifications
 */
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

/**
 * Hook for managing notification preferences with optimistic updates
 */
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

    // ROK-180 AC-7: Fetch channel availability
    const { data: channelAvailability } = useQuery({
        queryKey: ['notifications', 'channels'],
        queryFn: fetchChannelAvailability,
        staleTime: PREFERENCES_STALE_TIME,
    });

    const updateMutation = useMutation({
        mutationFn: patchPreferences,
        onMutate: async (input: UpdatePreferencesInput) => {
            await queryClient.cancelQueries({ queryKey });
            const previous = queryClient.getQueryData<NotificationPreferences>(queryKey);

            // Optimistic update: deep-merge input into current prefs
            if (previous) {
                const optimistic: NotificationPreferences = {
                    ...previous,
                    channelPrefs: { ...previous.channelPrefs },
                };
                for (const [type, channels] of Object.entries(input.channelPrefs)) {
                    const t = type as NotificationType;
                    if (optimistic.channelPrefs[t] && channels) {
                        optimistic.channelPrefs[t] = {
                            ...optimistic.channelPrefs[t],
                            ...channels,
                        };
                    }
                }
                queryClient.setQueryData<NotificationPreferences>(queryKey, optimistic);
            }

            return { previous };
        },
        onSuccess: () => {
            toast.success('Preferences updated', { id: 'notif-prefs' });
        },
        onError: (_err, _vars, context) => {
            if ((context as { previous?: NotificationPreferences })?.previous) {
                queryClient.setQueryData(
                    queryKey,
                    (context as { previous: NotificationPreferences }).previous,
                );
            }
            toast.error('Failed to update preferences', { id: 'notif-prefs' });
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

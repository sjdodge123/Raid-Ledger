import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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

export interface NotificationPreferences {
    userId: number;
    inAppEnabled: boolean;
    slotVacated: boolean;
    eventReminders: boolean;
    newEvents: boolean;
    subscribedGames: boolean;
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
async function updatePreferences(
    prefs: Partial<NotificationPreferences>,
): Promise<NotificationPreferences> {
    const token = getAuthToken();
    if (!token) throw new Error('Not authenticated');

    const response = await fetch(`${API_BASE_URL}/notifications/preferences`, {
        method: 'PATCH',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(prefs),
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
}

// Cache configuration
const NOTIFICATION_STALE_TIME = 30 * 1000; // 30 seconds
const PREFERENCES_STALE_TIME = 5 * 60 * 1000; // 5 minutes

/**
 * Hook for managing notifications
 * @param limit - Maximum number of notifications to fetch (default: 20)
 * @param offset - Pagination offset (default: 0)
 * @returns Object containing:
 *   - notifications: Array of notification objects
 *   - unreadCount: Number of unread notifications
 *   - isLoading: Loading state for initial fetch
 *   - error: Error object if fetch failed
 *   - markRead: Function to mark a single notification as read (notificationId: string) => void
 *   - markAllRead: Function to mark all notifications as read () => void
 */
export function useNotifications(limit = 20, offset = 0) {
    const queryClient = useQueryClient();

    // Fetch all notifications
    const {
        data: notifications = [],
        isLoading,
        error,
    } = useQuery({
        queryKey: ['notifications', limit, offset],
        queryFn: () => fetchNotifications(limit, offset),
        staleTime: NOTIFICATION_STALE_TIME,
    });

    // Fetch unread count
    const { data: unreadCount = 0 } = useQuery({
        queryKey: ['notifications', 'unread-count'],
        queryFn: fetchUnreadCount,
        staleTime: NOTIFICATION_STALE_TIME,
    });

    // Mark single notification as read
    const markReadMutation = useMutation({
        mutationFn: markNotificationRead,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['notifications'] });
        },
    });

    // Mark all as read
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
 * Hook for managing notification preferences
 * @returns Object containing:
 *   - preferences: User's notification preferences object
 *   - isLoading: Loading state for initial fetch
 *   - error: Error object if fetch failed
 *   - updatePreferences: Function to update preferences (prefs: Partial<NotificationPreferences>) => void
 */
export function useNotificationPreferences() {
    const queryClient = useQueryClient();

    const {
        data: preferences,
        isLoading,
        error,
    } = useQuery({
        queryKey: ['notifications', 'preferences'],
        queryFn: fetchPreferences,
        staleTime: PREFERENCES_STALE_TIME,
    });

    const updateMutation = useMutation({
        mutationFn: updatePreferences,
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: ['notifications', 'preferences'],
            });
        },
    });

    return {
        preferences,
        isLoading,
        error,
        updatePreferences: updateMutation.mutate,
    };
}


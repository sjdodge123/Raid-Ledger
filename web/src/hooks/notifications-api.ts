/**
 * Raw API functions for the notifications domain.
 * Consumed by use-notifications.ts hooks.
 */
import { API_BASE_URL } from '../lib/config';
import { getAuthToken } from './use-auth';
import type { Notification, NotificationPreferences, UpdatePreferencesInput, ChannelAvailability } from './use-notifications';

/** Fetch all notifications for the current user */
export async function fetchNotifications(
    limit = 20,
    offset = 0,
): Promise<Notification[]> {
    const token = getAuthToken();
    if (!token) throw new Error('Not authenticated');

    const response = await fetch(
        `${API_BASE_URL}/notifications?limit=${limit}&offset=${offset}`,
        { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
}

/** Fetch unread notification count */
export async function fetchUnreadCount(): Promise<number> {
    const token = getAuthToken();
    if (!token) return 0;

    const response = await fetch(
        `${API_BASE_URL}/notifications/unread/count`,
        { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    return data.count;
}

/** Mark a notification as read */
export async function markNotificationRead(
    notificationId: string,
): Promise<void> {
    const token = getAuthToken();
    if (!token) throw new Error('Not authenticated');

    const response = await fetch(
        `${API_BASE_URL}/notifications/${notificationId}/read`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
    );

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
}

/** Mark all notifications as read */
export async function markAllNotificationsRead(): Promise<void> {
    const token = getAuthToken();
    if (!token) throw new Error('Not authenticated');

    const response = await fetch(
        `${API_BASE_URL}/notifications/read-all`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
    );

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
}

/** Fetch notification preferences */
export async function fetchPreferences(): Promise<NotificationPreferences> {
    const token = getAuthToken();
    if (!token) throw new Error('Not authenticated');

    const response = await fetch(
        `${API_BASE_URL}/notifications/preferences`,
        { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
}

/** Update notification preferences */
export async function patchPreferences(
    input: UpdatePreferencesInput,
): Promise<NotificationPreferences> {
    const token = getAuthToken();
    if (!token) throw new Error('Not authenticated');

    const response = await fetch(
        `${API_BASE_URL}/notifications/preferences`,
        {
            method: 'PATCH',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(input),
        },
    );

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
}

/** Fetch notification channel availability (ROK-180 AC-7) */
export async function fetchChannelAvailability(): Promise<ChannelAvailability> {
    const token = getAuthToken();
    if (!token) {
        return { discord: { available: false, reason: 'Not authenticated' } };
    }

    const response = await fetch(
        `${API_BASE_URL}/notifications/channels`,
        { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!response.ok) {
        return { discord: { available: false } };
    }

    return response.json();
}

import type { Channel } from '../../hooks/use-notifications';

/** The caption a notification-type row shows under its description (ROK-2290). */
export type NotificationRowCaption = 'Discord DM only' | 'Muted' | null;

/**
 * Says what a row's switches add up to, judged on the switches the member can SEE:
 * - bell off + Discord on (Discord column shown) → "Discord DM only"
 * - every visible channel off → "Muted"
 * - anything else → no caption.
 * A hidden Discord column never yields "Discord DM only". Missing values read as off,
 * matching how the switches render.
 */
export function notificationRowCaption(
    prefs: Partial<Record<Channel, boolean>> | undefined,
    visibleChannels: readonly Channel[],
): NotificationRowCaption {
    const on = (channel: Channel) => prefs?.[channel] ?? false;
    if (!on('inApp') && visibleChannels.includes('discord') && on('discord')) return 'Discord DM only';
    if (visibleChannels.every((channel) => !on(channel))) return 'Muted';
    return null;
}

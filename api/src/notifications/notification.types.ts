/**
 * Notification type definitions.
 * Extracted from notification.service.ts for file size compliance (ROK-711).
 */
import type {
  ChannelPrefs,
  NotificationType,
} from '../drizzle/schema/notification-preferences';

export type { ChannelPrefs, NotificationType };
export type Channel = 'inApp' | 'push' | 'discord';

export interface CreateNotificationInput {
  userId: number;
  type: NotificationType;
  title: string;
  message: string;
  payload?: Record<string, any>;
  expiresAt?: Date;
  /** Skip the Discord DM dispatch (e.g., when a custom Discord DM is sent separately) */
  skipDiscord?: boolean;
  /**
   * With `skipDiscord`: the caller sends its own DM using the returned row id,
   * so bell off + Discord on still stores a hidden row (ROK-2290). Without it a
   * `skipDiscord` input with the bell off is not stored at all.
   */
  callerSendsDm?: true;
}

export interface NotificationDto {
  id: string;
  userId: number;
  type: string;
  title: string;
  message: string;
  payload?: Record<string, any>;
  readAt?: string;
  createdAt: string;
  expiresAt?: string;
}

export interface NotificationPreferencesDto {
  userId: number;
  channelPrefs: ChannelPrefs;
}

export interface UpdatePreferencesInput {
  channelPrefs: Partial<
    Record<NotificationType, Partial<Record<Channel, boolean>>>
  >;
}

/**
 * Preference merging helpers for NotificationService.
 * Extracted from notification.service.ts to satisfy file size limits.
 */
import type {
  ChannelPrefs,
  NotificationType,
} from '../drizzle/schema/notification-preferences';
import type { UpdatePreferencesInput } from './notification.types';

/** Deep-merge incoming partial preferences with current. */
export function mergePreferences(
  current: ChannelPrefs,
  input: UpdatePreferencesInput,
): ChannelPrefs {
  const merged: ChannelPrefs = { ...current };
  for (const [type, channels] of Object.entries(input.channelPrefs)) {
    const notifType = type as NotificationType;
    if (merged[notifType] && channels)
      merged[notifType] = { ...merged[notifType], ...channels };
  }
  return merged;
}

/** Detect if Discord was just enabled for the first time. */
export function detectDiscordEnabled(
  previous: ChannelPrefs,
  merged: ChannelPrefs,
): boolean {
  const wasEnabled = Object.values(previous).some((ch) => ch.discord === true);
  const nowEnabled = Object.values(merged).some((ch) => ch.discord === true);
  return !wasEnabled && nowEnabled;
}

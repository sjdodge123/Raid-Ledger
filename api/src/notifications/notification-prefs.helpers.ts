/**
 * Preference merging helpers for NotificationService.
 * Extracted from notification.service.ts to satisfy file size limits.
 */
import { z } from 'zod';
import {
  CHANNELS,
  NOTIFICATION_TYPES,
  type ChannelPrefs,
  type NotificationType,
} from '../drizzle/schema/notification-preferences';
import { parseOrBadRequest } from '../users/users-controller.helpers';
import type { UpdatePreferencesInput } from './notification.types';

/**
 * Runtime shape of PATCH /notifications/preferences. Only known types and
 * channels, and only boolean values, so nothing else reaches channel_prefs
 * (its `::boolean` casts in the follow-up fan-out SQL would throw).
 */
export const UpdatePreferencesSchema = z
  .object({
    channelPrefs: z.partialRecord(
      z.enum(NOTIFICATION_TYPES),
      z.partialRecord(z.enum(CHANNELS), z.boolean()),
    ),
  })
  .strict();

/** Parse a raw preferences body; throws BadRequestException when invalid. */
export function parseUpdatePreferencesBody(
  body: unknown,
): UpdatePreferencesInput {
  return parseOrBadRequest(UpdatePreferencesSchema, body);
}

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

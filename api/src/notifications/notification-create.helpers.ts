/**
 * How a new notification is delivered, decided from the member's switches
 * (ROK-2290). The bell and Discord switches are separate: bell off with
 * Discord on still sends the DM, backed by a row hidden from the bell so the
 * DM's buttons (`?notif=<id>`) keep a real id. Discord-linked / bot-up /
 * rate-limit checks stay inside `DiscordNotificationService.dispatch` (Q4).
 */
import type { NotificationType } from '../drizzle/schema/notification-preferences';
import type * as schema from '../drizzle/schema';
import { resolveChannelPrefs } from './notification-mapping.helpers';
import type {
  CreateNotificationInput,
  NotificationPreferencesDto,
} from './notification.types';

/** 'both' = visible row (+ DM if Discord allows); 'dm-only' = hidden row + DM. */
export type Delivery = 'both' | 'dm-only' | 'none';

/** A hidden row with no caller expiry is removed by the 04:00 cleanup (Q3). */
export const HIDDEN_ROW_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Resolve delivery for one type; a missing type entry takes its default.
 * `skipDiscord` callers (invite, GG) send their own DM with the returned row
 * id, so a hidden row is still written for them.
 */
export function resolveDelivery(
  type: NotificationType,
  prefs: NotificationPreferencesDto | undefined,
): Delivery {
  return resolveStoredDelivery(type, prefs?.channelPrefs);
}

/**
 * `resolveDelivery` over a raw stored `channel_prefs` value (callers that read
 * the column directly). Pre-checks that skip a member must skip only 'none' —
 * bell off with Discord on still delivers the DM.
 */
export function resolveStoredDelivery(
  type: NotificationType,
  storedChannelPrefs: unknown,
): Delivery {
  const channels = resolveChannelPrefs(storedChannelPrefs)[type];
  if (channels.inApp) return 'both';
  return channels.discord ? 'dm-only' : 'none';
}

/** Insert values for one input; a hidden row gets the 30-day expiry. */
export function buildNotificationValues(
  input: CreateNotificationInput,
  delivery: Exclude<Delivery, 'none'>,
  now: Date = new Date(),
): typeof schema.notifications.$inferInsert {
  const hidden = delivery === 'dm-only';
  const fallbackExpiry = hidden
    ? new Date(now.getTime() + HIDDEN_ROW_TTL_MS)
    : null;
  return {
    userId: input.userId,
    type: input.type,
    title: input.title,
    message: input.message,
    payload: input.payload ?? null,
    expiresAt: input.expiresAt ?? fallbackExpiry,
    inAppHidden: hidden,
  };
}

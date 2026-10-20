/**
 * Where a DM's "Adjust Notifications" button sends the player (ROK-1797 §7).
 *
 * Per-game types go to the game page, which opens its notification bell
 * (`?action=notifications`) and marks the DM read (`&notif=`). Every other
 * type goes to its own row on the settings page (`#notif-<type>`); the web
 * scrolls to and focuses that row, and does nothing if no row has that id.
 *
 * Links always target `/profile/notifications` directly, never the legacy
 * `/profile/preferences/notifications` redirect.
 */
import {
  NOTIFICATION_TYPES,
  type NotificationType,
} from '../drizzle/schema/notification-preferences';

type AdjustTarget = 'game' | 'settings';

/**
 * Exhaustive by construction: a `NotificationType` added without a row here
 * fails `tsc`, so a new type can never silently fall through to a default.
 */
const ADJUST_TARGET: Record<NotificationType, AdjustTarget> = {
  slot_vacated: 'settings',
  event_reminder: 'settings',
  new_event: 'settings',
  subscribed_game: 'game',
  achievement_unlocked: 'settings',
  level_up: 'settings',
  missed_event_nudge: 'settings',
  event_rescheduled: 'settings',
  event_delayed: 'settings',
  running_late: 'settings',
  bench_promoted: 'settings',
  event_cancelled: 'settings',
  roster_reassigned: 'settings',
  tentative_displaced: 'settings',
  member_returned: 'settings',
  recruitment_reminder: 'game',
  role_gap_alert: 'settings',
  lineup_steam_nudge: 'settings',
  /** OQ-1 default: the standalone poll payload has no gameId — settings row. */
  community_lineup: 'settings',
  user_deactivated_discord: 'settings',
  user_reactivated_discord: 'settings',
  post_event_followup: 'settings',
  lfg_invite: 'game',
  lfg_player_invite: 'settings',
  hub_leader_post: 'settings',
  hub_event_tagged: 'settings',
  hub_proposal_submitted: 'settings',
  hub_proposal_reviewed: 'settings',
  system: 'settings',
};

/** Types whose Adjust button lands on the game page when a gameId is known. */
export const PER_GAME_NOTIFICATION_TYPES: readonly NotificationType[] =
  NOTIFICATION_TYPES.filter((t) => ADJUST_TARGET[t] === 'game');

const POSITIVE_INT = /^[1-9]\d*$/;

/** A positive integer `gameId` (number or numeric string), else null. */
function parseGameId(raw: unknown): number | null {
  const n =
    typeof raw === 'string' && POSITIVE_INT.test(raw) ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}

/** The settings page, optionally deep-linked to one type's row. */
export function buildNotificationSettingsUrl(
  clientUrl: string,
  type?: NotificationType,
): string {
  const base = `${clientUrl}/profile/notifications`;
  return type ? `${base}?type=${type}#notif-${type}` : base;
}

/** The "Adjust Notifications" URL for one DM (see the module header). */
export function buildAdjustNotificationsUrl(
  type: NotificationType,
  payload: Record<string, unknown> | undefined,
  notificationId: string | undefined,
  clientUrl: string,
): string {
  const gameId =
    ADJUST_TARGET[type] === 'game' ? parseGameId(payload?.gameId) : null;
  if (gameId === null) return buildNotificationSettingsUrl(clientUrl, type);
  const url = `${clientUrl}/games/${gameId}?action=notifications`;
  return notificationId
    ? `${url}&notif=${encodeURIComponent(notificationId)}`
    : url;
}

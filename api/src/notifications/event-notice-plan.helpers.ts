/**
 * ROK-1832 D4/D5 — the merged "new event" notice plan and its per-user claim.
 *
 * Kept out of `game-affinity-notification.service.ts` so that file stays under
 * the size cap; both helpers are pure over their injected dependencies.
 */
import type { NotificationDedupService } from './notification-dedup.service';

/** 30 days — the same TTL as the per-event `game-alert:event:<id>` key. */
export const EVENT_NOTICE_TTL_SECONDS = 30 * 24 * 60 * 60;

export type EventNoticeType = 'hub_event_tagged' | 'subscribed_game';

export interface EventNoticePlanInput {
  /** Game-affinity recipients (already game-mute filtered, actor excluded). */
  affinityIds: readonly number[];
  /** Group recipients (D3 set, actor excluded upstream). */
  groupIds: readonly number[];
  /** Users who muted the group. */
  groupMuted: ReadonlySet<number>;
  /** Users with both `hub_event_tagged` channels (inApp + discord) off. */
  groupTypeOff: ReadonlySet<number>;
}

export interface EventNotice {
  userId: number;
  type: EventNoticeType;
}

/**
 * D5: one notice per user; the group copy wins unless the user muted the
 * group or switched the group type off, then the game copy (if eligible).
 */
export function planEventNotices(input: EventNoticePlanInput): EventNotice[] {
  const affinity = new Set(input.affinityIds);
  const plan = new Map<number, EventNoticeType>();
  for (const userId of input.groupIds) {
    if (input.groupMuted.has(userId) || input.groupTypeOff.has(userId)) {
      continue;
    }
    plan.set(userId, 'hub_event_tagged');
  }
  for (const userId of affinity) {
    if (!plan.has(userId)) plan.set(userId, 'subscribed_game');
  }
  return [...plan].map(([userId, type]) => ({ userId, type }));
}

/** The D4 per-(user, event) claim key. */
export function eventNoticeKey(eventId: number, userId: number): string {
  return `event-notice:${eventId}:user:${userId}`;
}

/**
 * D4: claim the per-(user, event) key, then send. Returns false when another
 * path already noticed this user about this event. A failed send — or one
 * that created nothing (`create` resolves `null` when the type's channels are
 * off) — gives the claim back, so a later path (a late group tag) or a retry
 * is not suppressed for the whole TTL.
 */
export async function sendClaimedEventNotice(
  dedup: Pick<NotificationDedupService, 'checkAndMarkSent' | 'releaseKey'>,
  eventId: number,
  userId: number,
  send: () => Promise<unknown>,
): Promise<boolean> {
  const key = eventNoticeKey(eventId, userId);
  if (await dedup.checkAndMarkSent(key, EVENT_NOTICE_TTL_SECONDS)) return false;
  try {
    if ((await send()) !== null) return true;
    await dedup.releaseKey(key);
    return false;
  } catch (err: unknown) {
    await dedup.releaseKey(key);
    throw err;
  }
}

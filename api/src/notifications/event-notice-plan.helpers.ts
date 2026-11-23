/**
 * ROK-1832 D4/D5 — the merged "new event" notice plan and its per-user claim.
 *
 * Kept out of `game-affinity-notification.service.ts` so that file stays under
 * the size cap; the helpers here are pure.
 */

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
  /** Users whose `hub_event_tagged` inApp is off (`create` would return null). */
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

/**
 * The event-level announce claim (Codex r7). The scheduler's group-only send
 * claims its own key, so it never consumes the full announcement's
 * `game-alert:event:<id>` claim; the per-user keys below still dedupe users
 * across the two sends. Both prefixes start `game-alert`, so the test resets
 * that purge `game-alert*` cover them.
 */
export function eventAnnounceKey(eventId: number, groupOnly: boolean): string {
  return groupOnly
    ? `game-alert-group:event:${eventId}`
    : `game-alert:event:${eventId}`;
}

/** The D4 per-(user, event) claim key. */
export function eventNoticeKey(eventId: number, userId: number): string {
  return `event-notice:${eventId}:user:${userId}`;
}

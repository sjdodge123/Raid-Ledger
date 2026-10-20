import { sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { toDiscordTimestamp } from '../discord-bot/utils/time-parser';
import type { NotificationService } from './notification.service';
import type { CreateNotificationInput } from './notification.types';
import { resolvePostEventFollowupRecipients } from './post-event-followup.helpers';
import {
  EVENT_NOTICE_TTL_SECONDS,
  eventNoticeKey,
} from './event-notice-plan.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Dependencies for the shared follow-up fan-out (typed to avoid a runtime cycle). */
export interface FollowupFanoutDeps {
  db: Db;
  notificationService: Pick<NotificationService, 'createMany'>;
}

/** Discriminated payload — event path carries a new eventId, poll path a match. */
export type FollowupFanoutPayload =
  | { eventId: number }
  | { lineupId: number; matchId: number; subtype: 'post_event_poll' };

/** Ended event row needed for the tampering guard + DM copy. */
type EndedEvent = {
  id: number;
  title: string;
  creator_id: number;
};

/**
 * Atomically claim the one-time fan-out for an ended event (ROK-1371 M4). Sets
 * `attendees_notified_at = now()` iff it is still null. Returns true when THIS
 * caller won the claim; false when it was already claimed (or no prompt row
 * exists — a safe no-op).
 */
async function claimFanout(db: Db, endedEventId: number): Promise<boolean> {
  const rows = await db.execute<{ id: number }>(sql`
    UPDATE post_event_followup_sent
    SET attendees_notified_at = now()
    WHERE event_id = ${endedEventId} AND attendees_notified_at IS NULL
    RETURNING id
  `);
  return Array.from(rows).length > 0;
}

/** Release a previously-won fan-out claim (rollback on guard-fail / error). */
async function releaseFanout(db: Db, endedEventId: number): Promise<void> {
  await db.execute(sql`
    UPDATE post_event_followup_sent
    SET attendees_notified_at = NULL
    WHERE event_id = ${endedEventId}
  `);
}

/** Load the ended event's id/title/creator for the guard + DM copy. */
async function loadEndedEvent(
  db: Db,
  endedEventId: number,
): Promise<EndedEvent | null> {
  const rows = await db.execute<EndedEvent>(sql`
    SELECT id, title, creator_id FROM events WHERE id = ${endedEventId} LIMIT 1
  `);
  return Array.from(rows)[0] ?? null;
}

/**
 * Load an event's start (`lower(duration)`) as Unix epoch seconds, or null.
 * `duration` is a tsrange of UTC wall-clock timestamps; `EXTRACT(EPOCH …)` on a
 * `timestamp without time zone` treats the value as UTC (no session-TZ drift),
 * so the result is the correct absolute epoch. (ROK-1422)
 */
async function loadEventStartEpoch(
  db: Db,
  eventId: number,
): Promise<number | null> {
  const rows = await db.execute<{ epoch: string }>(sql`
    SELECT EXTRACT(EPOCH FROM lower(duration))::bigint AS epoch
    FROM events WHERE id = ${eventId} LIMIT 1
  `);
  const raw = Array.from(rows)[0]?.epoch;
  return raw != null ? Number(raw) : null;
}

/**
 * ROK-1422: render the follow-up event's start as native Discord timestamp
 * markup (`<t:…:F> (<t:…:R>)`) so the DM embed renders viewer-local and the
 * plaintext push preview resolves it in the recipient's timezone (via
 * `stripDiscordMarkup`). Returns '' when the start is unknown — never throws.
 */
function followupTimeSuffix(startEpoch: number | null): string {
  if (startEpoch == null) return '';
  const start = new Date(startEpoch * 1000);
  return ` — ${toDiscordTimestamp(start, 'F')} (${toDiscordTimestamp(start, 'R')})`;
}

/**
 * Build one quick-sign-up notification input per recipient. On the event path
 * (`{eventId}`) the follow-up event's start time (`startEpoch`) is appended as
 * `<t:>` markup so recipients see WHEN the event is before committing (ROK-1422).
 * The poll path has no fixed time yet, so it never carries a timestamp.
 */
export function buildInputs(
  recipients: number[],
  endedTitle: string,
  payload: FollowupFanoutPayload,
  startEpoch: number | null = null,
): CreateNotificationInput[] {
  const isPoll = 'matchId' in payload;
  const message = isPoll
    ? `Help pick a time for the next **${endedTitle}** session.`
    : `Sign up for the follow-up to **${endedTitle}**.${followupTimeSuffix(startEpoch)}`;
  return recipients.map((userId) => ({
    userId,
    type: 'post_event_followup' as const,
    title: isPoll ? 'Vote on a follow-up time' : 'Play again?',
    message,
    payload,
  }));
}

/**
 * Shared exactly-once attendee fan-out for the post-event follow-up (ROK-1371
 * M4). Called by BOTH the event-path server post-create hook and the poll-path
 * interaction handler. Enforces single-fire via the `attendees_notified_at`
 * claim, guards against forged `followupForEventId` (creator mismatch), and
 * routes through `NotificationService.createMany` (free deactivation + per-type
 * opt-out + rate-limit). Rolls the claim back and rethrows on failure so a
 * retry / the other path can re-attempt.
 *
 * @param deps - db + notificationService (typed, no runtime module cycle).
 * @param endedEventId - The just-ended event whose attendees to notify.
 * @param payload - Event-path `{eventId}` or poll-path `{lineupId,matchId,subtype}`.
 * @param actingCreatorId - The acting organizer; must equal the ended event's creator.
 */
export async function runFollowupFanout(
  deps: FollowupFanoutDeps,
  endedEventId: number,
  payload: FollowupFanoutPayload,
  actingCreatorId: number,
): Promise<void> {
  const { db } = deps;
  if (!(await claimFanout(db, endedEventId))) return;
  const ended = await loadEndedEvent(db, endedEventId);
  if (!ended || ended.creator_id !== actingCreatorId) {
    await releaseFanout(db, endedEventId);
    return;
  }
  await dispatchFollowupInvites(
    deps,
    endedEventId,
    ended.title,
    payload,
    actingCreatorId,
  );
}

/**
 * Resolve recipients, load the event-path start time, and dispatch the DMs via
 * `createMany`. Rolls the fan-out claim (and any per-user notice claims) back
 * and rethrows on failure so a retry (or the other path) can re-attempt.
 */
async function dispatchFollowupInvites(
  deps: FollowupFanoutDeps,
  endedEventId: number,
  endedTitle: string,
  payload: FollowupFanoutPayload,
  actingCreatorId: number,
): Promise<void> {
  const { db, notificationService } = deps;
  // Event path carries the new follow-up event's id + start time; the poll
  // path has no fixed time yet (ROK-1422) and no event to claim notices for.
  const eventId = 'eventId' in payload ? payload.eventId : null;
  let claimed: number[] = [];
  try {
    const recipients = await resolvePostEventFollowupRecipients(
      db,
      endedEventId,
      actingCreatorId,
    );
    const startEpoch =
      eventId !== null ? await loadEventStartEpoch(db, eventId) : null;
    if (eventId !== null) {
      claimed = await claimFollowupEventNotices(db, eventId, recipients);
    }
    const sendTo = eventId !== null ? claimed : recipients;
    await notificationService.createMany(
      buildInputs(sendTo, endedTitle, payload, startEpoch),
    );
  } catch (err) {
    await releaseFanout(db, endedEventId);
    if (eventId !== null) {
      await releaseFollowupEventNotices(db, eventId, claimed);
    }
    throw err;
  }
}

/**
 * ROK-1832 (Codex r3 + r8): claim each follow-up recipient's per-(user, event)
 * notice key for the follow-up event BEFORE sending, in the same
 * `notification_dedup` store `NotificationDedupService` reads. Whichever of
 * this fan-out and the scheduler's deferred group notice (which carries no
 * `followupForEventId`) claims a user first notices them; the other skips.
 * An expired row is taken over, as `checkAndMarkSent` does.
 *
 * @returns the recipients THIS call claimed — the only ones to DM.
 */
async function claimFollowupEventNotices(
  db: Db,
  eventId: number,
  userIds: readonly number[],
): Promise<number[]> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return [];
  const expiresAt = new Date(
    Date.now() + EVENT_NOTICE_TTL_SECONDS * 1000,
  ).toISOString();
  const rows = ids.map(
    (id) => sql`(${eventNoticeKey(eventId, id)}, ${expiresAt})`,
  );
  const won = await db.execute<{ dedup_key: string }>(sql`
    INSERT INTO notification_dedup (dedup_key, expires_at)
    VALUES ${sql.join(rows, sql`, `)}
    ON CONFLICT (dedup_key) DO UPDATE SET expires_at = EXCLUDED.expires_at
      WHERE notification_dedup.expires_at IS NOT NULL
        AND notification_dedup.expires_at < NOW()
    RETURNING dedup_key
  `);
  const keys = new Set(Array.from(won, (r) => r.dedup_key));
  return ids.filter((id) => keys.has(eventNoticeKey(eventId, id)));
}

/** Give back the notice claims of a fan-out whose send failed. */
async function releaseFollowupEventNotices(
  db: Db,
  eventId: number,
  userIds: readonly number[],
): Promise<void> {
  if (userIds.length === 0) return;
  const keys = userIds.map((id) => sql`${eventNoticeKey(eventId, id)}`);
  await db.execute(sql`
    DELETE FROM notification_dedup
    WHERE dedup_key IN (${sql.join(keys, sql`, `)})
  `);
}

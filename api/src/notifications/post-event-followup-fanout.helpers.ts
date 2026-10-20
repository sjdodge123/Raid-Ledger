import { sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { toDiscordTimestamp } from '../discord-bot/utils/time-parser';
import type { NotificationService } from './notification.service';
import type { NotificationDedupService } from './notification-dedup.service';
import type {
  CreateNotificationInput,
  NotificationDto,
} from './notification.types';
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

/** Releases per-user notice claims from BOTH dedup stores (Codex r10). */
export type FollowupNoticeDedup = Pick<NotificationDedupService, 'releaseKeys'>;

/** Event-path deps: its notice claims are released through the dedup service. */
export interface FollowupEventFanoutDeps extends FollowupFanoutDeps {
  noticeDedup: FollowupNoticeDedup;
}

type FollowupPollPayload = {
  lineupId: number;
  matchId: number;
  subtype: 'post_event_poll';
};

/** Discriminated payload — event path carries a new eventId, poll path a match. */
export type FollowupFanoutPayload = { eventId: number } | FollowupPollPayload;

/**
 * The event path's per-user notice scope. The poll path has no follow-up
 * event yet (ROK-1422) and so takes no notice claims.
 */
type NoticeScope = { eventId: number; dedup: FollowupNoticeDedup } | null;

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
export function runFollowupFanout(
  deps: FollowupEventFanoutDeps,
  endedEventId: number,
  payload: { eventId: number },
  actingCreatorId: number,
): Promise<void>;
export function runFollowupFanout(
  deps: FollowupFanoutDeps,
  endedEventId: number,
  payload: FollowupPollPayload,
  actingCreatorId: number,
): Promise<void>;
export async function runFollowupFanout(
  deps: FollowupFanoutDeps & Partial<FollowupEventFanoutDeps>,
  endedEventId: number,
  payload: FollowupFanoutPayload,
  actingCreatorId: number,
): Promise<void> {
  const { db } = deps;
  const scope = noticeScope(deps, payload);
  if (!(await claimFanout(db, endedEventId))) return;
  const ended = await loadEndedEvent(db, endedEventId);
  if (!ended || ended.creator_id !== actingCreatorId) {
    await releaseFanout(db, endedEventId);
    return;
  }
  await dispatchFollowupInvites(deps, endedEventId, ended.title, payload, {
    actingCreatorId,
    scope,
  });
}

/** Resolve the notice scope up front, before any claim is taken. */
function noticeScope(
  deps: Partial<FollowupEventFanoutDeps>,
  payload: FollowupFanoutPayload,
): NoticeScope {
  if (!('eventId' in payload)) return null;
  if (!deps.noticeDedup) {
    throw new Error('Follow-up event fan-out requires noticeDedup');
  }
  return { eventId: payload.eventId, dedup: deps.noticeDedup };
}

/**
 * Resolve recipients, load the event-path start time, and dispatch the DMs via
 * `createMany`. Rolls the fan-out claim (and any per-user notice claims) back
 * and rethrows on failure so a retry (or the other path) can re-attempt. On
 * success only the claims of recipients actually notified are kept.
 */
async function dispatchFollowupInvites(
  deps: FollowupFanoutDeps,
  endedEventId: number,
  endedTitle: string,
  payload: FollowupFanoutPayload,
  { actingCreatorId, scope }: { actingCreatorId: number; scope: NoticeScope },
): Promise<void> {
  const claimed: number[] = [];
  let created: NotificationDto[];
  try {
    const recipients = await resolvePostEventFollowupRecipients(
      deps.db,
      endedEventId,
      actingCreatorId,
    );
    claimed.push(...(await claimForEvent(deps.db, scope, recipients)));
    const sendTo = scope !== null ? claimed : recipients;
    created = await sendInvites(deps, sendTo, endedTitle, payload);
  } catch (err) {
    await rollbackFollowup(deps.db, endedEventId, scope, claimed);
    throw err;
  }
  if (scope === null) return;
  await releaseFollowupEventNotices(scope, unnotified(claimed, created));
}

/** Event path: claim the recipients' notices; the poll path claims none. */
function claimForEvent(
  db: Db,
  scope: NoticeScope,
  recipients: number[],
): Promise<number[]> {
  if (scope === null) return Promise.resolve([]);
  return claimFollowupEventNotices(db, scope.eventId, recipients);
}

/** Create the DMs; the event path appends its start time (ROK-1422). */
async function sendInvites(
  deps: FollowupFanoutDeps,
  sendTo: number[],
  endedTitle: string,
  payload: FollowupFanoutPayload,
): Promise<NotificationDto[]> {
  const startEpoch =
    'eventId' in payload
      ? await loadEventStartEpoch(deps.db, payload.eventId)
      : null;
  return deps.notificationService.createMany(
    buildInputs(sendTo, endedTitle, payload, startEpoch),
  );
}

/** A failed send gives back the fan-out claim and every notice claim. */
async function rollbackFollowup(
  db: Db,
  endedEventId: number,
  scope: NoticeScope,
  claimed: readonly number[],
): Promise<void> {
  await releaseFanout(db, endedEventId);
  if (scope !== null) await releaseFollowupEventNotices(scope, claimed);
}

/**
 * ROK-1832 (Codex r9): the claimed recipients `createMany` created nothing for
 * (per-type opt-out, deactivation, rate limit). Their claims are released so
 * a later group notice or late tag can still reach them.
 */
function unnotified(
  claimed: readonly number[],
  created: readonly NotificationDto[],
): number[] {
  const notified = new Set(created.map((n) => n.userId));
  return claimed.filter((id) => !notified.has(id));
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

/**
 * Give back notice claims that produced no notification. Goes through
 * `NotificationDedupService` (Codex r10): a concurrent group notice that met
 * the pending claim cached it in Redis, and a DB-only delete would leave that
 * cache suppressing the user for the key's whole TTL.
 */
async function releaseFollowupEventNotices(
  scope: { eventId: number; dedup: FollowupNoticeDedup },
  userIds: readonly number[],
): Promise<void> {
  if (userIds.length === 0) return;
  await scope.dedup.releaseKeys(
    userIds.map((id) => eventNoticeKey(scope.eventId, id)),
  );
}

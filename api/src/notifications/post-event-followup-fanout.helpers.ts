import { sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { NotificationService } from './notification.service';
import type { CreateNotificationInput } from './notification.types';
import { resolvePostEventFollowupRecipients } from './post-event-followup.helpers';

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
interface EndedEvent {
  id: number;
  title: string;
  creator_id: number;
}

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

/** Build one quick-sign-up notification input per recipient. */
function buildInputs(
  recipients: number[],
  endedTitle: string,
  payload: FollowupFanoutPayload,
): CreateNotificationInput[] {
  const isPoll = 'matchId' in payload;
  const message = isPoll
    ? `Help pick a time for the next **${endedTitle}** session.`
    : `Sign up for the follow-up to **${endedTitle}**.`;
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
  const { db, notificationService } = deps;
  if (!(await claimFanout(db, endedEventId))) return;
  const ended = await loadEndedEvent(db, endedEventId);
  if (!ended || ended.creator_id !== actingCreatorId) {
    await releaseFanout(db, endedEventId);
    return;
  }
  try {
    const recipients = await resolvePostEventFollowupRecipients(
      db,
      endedEventId,
      actingCreatorId,
    );
    await notificationService.createMany(
      buildInputs(recipients, ended.title, payload),
    );
  } catch (err) {
    await releaseFanout(db, endedEventId);
    throw err;
  }
}

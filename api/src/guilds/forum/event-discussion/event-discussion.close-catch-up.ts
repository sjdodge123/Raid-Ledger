/**
 * ROK-2272 S0a — catch-up for the 24 h → 1 h write window. Threads created
 * before the change still store `write_closes_at = end + 24 h`, and the column
 * is only rewritten when the reconciler runs. On bootstrap this re-runs
 * `syncEventDiscussion` once per event whose live thread is STALE — stored
 * deadline still ahead AND later than the event's end + WRITE_GRACE_MS — so
 * the 5-min lock sweep closes them at end + 1 h. After the first deploy it
 * selects nothing. Idempotent; not a migration.
 */
import * as Sentry from '@sentry/nestjs';
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import type { Db } from '../hub-forum.queries';
import { syncEventDiscussion, WRITE_GRACE_MS } from './event-discussion.sync';

export const CLOSE_CATCH_UP_BATCH = 100;

/** `upper(duration)` is a naive UTC timestamp (tsrange) — pin it to UTC. */
const GRACE = sql.raw(`interval '${WRITE_GRACE_MS / 1000} seconds'`);

/**
 * Distinct event ids (> `afterId`) whose live thread is stale: deadline still
 * ahead of `now` and later than the event's end + grace.
 */
async function staleEventBatch(db: Db, now: Date, afterId: number) {
  const t = schema.hubForumThreads;
  const e = schema.events;
  const at = sql`${now.toISOString()}::timestamptz`;
  const due = sql`(upper(${e.duration}) AT TIME ZONE 'UTC') + ${GRACE}`;
  return db
    .selectDistinct({ eventId: e.id })
    .from(t)
    .innerJoin(e, eq(e.id, t.eventId))
    .where(
      and(
        isNull(t.eventDetachedAt),
        gt(t.writeClosesAt, at),
        gt(t.writeClosesAt, due),
        gt(e.id, afterId),
      ),
    )
    .orderBy(asc(e.id))
    .limit(CLOSE_CATCH_UP_BATCH);
}

async function syncOne(db: Db, eventId: number, now: Date): Promise<boolean> {
  try {
    await syncEventDiscussion(db, eventId, now);
    return true;
  } catch (err) {
    Sentry.captureException(err, {
      tags: { event_discussion: 'close-catch-up' },
      extra: { eventId },
    });
    return false;
  }
}

/**
 * Re-derive `write_closes_at` for every event with a stale live thread.
 * Returns how many events were reconciled; a failed event is reported to
 * Sentry and skipped, never thrown.
 */
export async function closeCatchUp(db: Db, now: Date): Promise<number> {
  let afterId = 0;
  let synced = 0;
  for (;;) {
    const rows = await staleEventBatch(db, now, afterId);
    for (const row of rows) {
      if (await syncOne(db, row.eventId, now)) synced += 1;
    }
    const last = rows.at(-1);
    if (!last || rows.length < CLOSE_CATCH_UP_BATCH) return synced;
    afterId = last.eventId;
  }
}

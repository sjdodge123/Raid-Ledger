/**
 * ROK-2272 S0a — one-shot catch-up for the 24 h → 1 h write window. Threads
 * created before the change still store `write_closes_at = end + 24 h`, and
 * the column is only rewritten when the reconciler runs. On bootstrap this
 * re-runs `syncEventDiscussion` for every live event thread whose stored
 * deadline is still ahead, so the 5-min lock sweep closes them at end + 1 h.
 * Idempotent (an up-to-date thread is a no-op refresh); not a migration.
 */
import * as Sentry from '@sentry/nestjs';
import { and, asc, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import type { Db } from '../hub-forum.queries';
import { syncEventDiscussion } from './event-discussion.sync';

export const CLOSE_CATCH_UP_BATCH = 100;

/** Event ids of live threads with a deadline after `now`, id > `afterId`. */
async function liveFutureBatch(db: Db, now: Date, afterId: number) {
  const t = schema.hubForumThreads;
  const at = sql`${now.toISOString()}::timestamptz`;
  return db
    .select({ id: t.id, eventId: t.eventId })
    .from(t)
    .where(
      and(
        isNotNull(t.eventId),
        isNull(t.eventDetachedAt),
        gt(t.writeClosesAt, at),
        gt(t.id, afterId),
      ),
    )
    .orderBy(asc(t.id))
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
 * Re-derive `write_closes_at` for live event threads still open at `now`.
 * Returns how many events were reconciled; a failed event is reported to
 * Sentry and skipped, never thrown.
 */
export async function closeCatchUp(db: Db, now: Date): Promise<number> {
  let afterId = 0;
  let synced = 0;
  for (;;) {
    const rows = await liveFutureBatch(db, now, afterId);
    for (const row of rows) {
      if (row.eventId !== null && (await syncOne(db, row.eventId, now))) {
        synced += 1;
      }
    }
    const last = rows.at(-1);
    if (!last || rows.length < CLOSE_CATCH_UP_BATCH) return synced;
    afterId = last.id;
  }
}

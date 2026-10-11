/**
 * ROK-1596 D11 / epic ROK-669 §4.5.3: the nightly heal. Enqueues `reconcile`
 * for (a) write connections × active sign-ups whose event ends within the
 * next 28 days and (b) existing copies whose event row is gone or cancelled
 * (an event deleted without an emit — §5 test 7a as read by plan F14) or
 * whose event is still live in that window (a missed sign-up delete). Each
 * job re-reads the world (D1), so an over-wide key costs one noop job.
 * Suppressed links (Undo, incl. empty-id placeholders) are never keyed.
 */
import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Cron } from '@nestjs/schedule';
import type { Queue } from 'bullmq';
import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { getCalendarSyncEnabled } from '../../settings/settings-calendar-sync.helpers';
import { SettingsService } from '../../settings/settings.service';
import { CALENDAR_WRITE_QUEUE } from '../calendar-sync.constants';
import { enqueueCalendarWriteJob } from './calendar-write.enqueue.helpers';
import { dedupeKeys } from './calendar-write-fanout.helpers';
import type { ReconcileKey } from './calendar-write-reconcile.helpers';

type Db = PostgresJsDatabase<typeof schema>;

export const RECONCILE_CRON_NAME = 'CalendarWriteReconcileCron_reconcile';
export const RECONCILE_WINDOW_MS = 28 * 24 * 60 * 60 * 1000;

const { calendarConnections: conn, calendarEventLinks: links } = schema;
const { eventSignups: signups, events: ev } = schema;
const ends = sql`upper(${ev.duration})`;

/** Ended events are frozen (F5): never keyed. */
const notEnded = (now: Date) => sql`${ends} > ${now.toISOString()}::timestamp`;

/** Event ends in (now, now + 28d]. */
function endsInWindow(now: Date) {
  const until = new Date(now.getTime() + RECONCILE_WINDOW_MS);
  return and(notEnded(now), sql`${ends} <= ${until.toISOString()}::timestamp`);
}

/** (a) active sign-ups × write connections, minus suppressed copies. */
function findSignupKeys(db: Db, now: Date): Promise<ReconcileKey[]> {
  return db
    .select({ connectionId: conn.id, eventId: ev.id, userId: conn.userId })
    .from(signups)
    .innerJoin(conn, eq(conn.userId, signups.userId))
    .innerJoin(ev, eq(ev.id, signups.eventId))
    .leftJoin(
      links,
      and(eq(links.connectionId, conn.id), eq(links.eventId, ev.id)),
    )
    .where(
      and(
        eq(conn.writeEnabled, true),
        eq(conn.status, 'active'),
        inArray(signups.status, ['signed_up', 'tentative']),
        isNull(ev.cancelledAt),
        endsInWindow(now),
        or(isNull(links.id), ne(links.state, 'suppressed')),
      ),
    );
}

/** (b) non-suppressed copies: event missing, cancelled (any date) or live. */
function findLinkKeys(db: Db, now: Date): Promise<ReconcileKey[]> {
  return db
    .select({
      connectionId: links.connectionId,
      eventId: links.eventId,
      userId: links.userId,
    })
    .from(links)
    .leftJoin(ev, eq(ev.id, links.eventId))
    .where(
      and(
        ne(links.state, 'suppressed'),
        or(
          isNull(ev.id),
          and(isNotNull(ev.cancelledAt), notEnded(now)),
          endsInWindow(now),
        ),
      ),
    );
}

@Injectable()
export class CalendarWriteReconcileCron {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly cronJobService: CronJobService,
    @InjectQueue(CALENDAR_WRITE_QUEUE) private readonly queue: Queue,
  ) {}

  @Cron('0 4 * * *', { name: RECONCILE_CRON_NAME })
  async reconcile(): Promise<void> {
    await this.cronJobService.executeWithTracking(RECONCILE_CRON_NAME, () =>
      this.run().then(() => undefined),
    );
  }

  /** Kill switch first (no reads while off); returns the keys queued. */
  async run(now = new Date()): Promise<ReconcileKey[]> {
    if (!(await getCalendarSyncEnabled(this.settings))) return [];
    const keys = dedupeKeys([
      ...(await findSignupKeys(this.db, now)),
      ...(await findLinkKeys(this.db, now)),
    ]);
    const deps = {
      queue: this.queue,
      isSyncEnabled: () => Promise.resolve(true),
    };
    for (const key of keys) {
      await enqueueCalendarWriteJob(deps, { kind: 'reconcile', ...key });
    }
    return keys;
  }
}

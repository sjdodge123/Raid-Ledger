/**
 * ROK-1593 D7 (§3.4): every 15 minutes, queue a read sync for each due
 * connection — read on, `active`, `next_sync_at` unset or past (a failed
 * sync stays `active` and backs `next_sync_at` off, D5, so it is re-picked
 * once that passes);
 * oldest first, 200 per tick. Each picked row's `next_sync_at` is pushed out
 * 30 min ± 5 min (a lease: a lost job is re-picked later, never every tick;
 * a successful sync re-stamps it anyway). Also prunes ended busy blocks and
 * (PR-B) ignored days older than UTC yesterday — both run even while the
 * kill switch is off.
 *
 * PR-B self-heal (review MAJOR-1/2, `calendar-away-heal.helpers.ts`): while
 * the switch is off each tick deletes any synced absence still stored (a
 * failed or raced admin purge); while it is on each tick queues a derive for
 * users whose synced absences point at a connection that stopped counting.
 */
import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Cron } from '@nestjs/schedule';
import type { Queue } from 'bullmq';
import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { getCalendarSyncEnabled } from '../../settings/settings-calendar-sync.helpers';
import { SettingsService } from '../../settings/settings.service';
import { GameTimeService } from '../../users/game-time.service';
import { CALENDAR_READ_QUEUE } from '../calendar-sync.constants';
import {
  enqueueDerivesBestEffort,
  findUsersWithStaleCalendarAbsences,
  purgeStrayCalendarAbsences,
} from './calendar-away-heal.helpers';
import {
  READ_SYNCABLE_STATUSES,
  enqueueCalendarReadSyncs,
} from './calendar-read.enqueue.helpers';
import {
  pruneEndedBusyBlocks,
  pruneStaleIgnoredDays,
} from './calendar-read-purge.helpers';
import { nextReadSyncAt } from './calendar-read-sync.helpers';

type Db = PostgresJsDatabase<typeof schema>;

export const READ_CRON_NAME = 'CalendarReadCron_sync';
export const READ_CRON_LIMIT = 200;

const c = schema.calendarConnections;

/** D7 due filter. */
export function dueReadConnectionFilter(now: Date) {
  return and(
    eq(c.readEnabled, true),
    inArray(c.status, [...READ_SYNCABLE_STATUSES]),
    or(isNull(c.nextSyncAt), lte(c.nextSyncAt, now)),
  );
}

/** Due connection ids, oldest `next_sync_at` first (never-synced first). */
export async function findDueReadConnections(
  db: Db,
  now: Date,
): Promise<number[]> {
  const rows = await db
    .select({ id: c.id })
    .from(c)
    .where(dueReadConnectionFilter(now))
    .orderBy(sql`${c.nextSyncAt} asc nulls first`, asc(c.id))
    .limit(READ_CRON_LIMIT);
  return rows.map((r) => r.id);
}

/** Lease each picked row until its next regular slot (D7 jitter). */
export async function leaseReadConnections(
  db: Db,
  ids: readonly number[],
  now: Date,
  random: () => number,
): Promise<void> {
  for (const id of ids) {
    await db
      .update(c)
      .set({ nextSyncAt: nextReadSyncAt(now, random) })
      .where(eq(c.id, id));
  }
}

@Injectable()
export class CalendarReadCron {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly cronJobService: CronJobService,
    @InjectQueue(CALENDAR_READ_QUEUE) private readonly queue: Queue,
    private readonly gameTime: GameTimeService,
  ) {}

  @Cron('*/15 * * * *', { name: READ_CRON_NAME })
  async sync(): Promise<void> {
    await this.cronJobService.executeWithTracking(READ_CRON_NAME, () =>
      this.run().then(() => undefined),
    );
  }

  /** Kill switch first (no reads while off); returns the ids queued. */
  async run(now = new Date(), random = Math.random): Promise<number[]> {
    await pruneEndedBusyBlocks(this.db, now);
    await pruneStaleIgnoredDays(this.db, now);
    if (!(await getCalendarSyncEnabled(this.settings))) {
      await this.purgeStrayAbsences();
      return [];
    }
    const stale = await findUsersWithStaleCalendarAbsences(this.db, now);
    await enqueueDerivesBestEffort(this.queue, stale, 'stale connection');
    const ids = await findDueReadConnections(this.db, now);
    await leaseReadConnections(this.db, ids, now, random);
    const deps = {
      queue: this.queue,
      isSyncEnabled: () => Promise.resolve(true),
    };
    await enqueueCalendarReadSyncs(deps, ids);
    return ids;
  }

  /** Switch off: synced away days must not count (D10 / Q12). */
  private async purgeStrayAbsences(): Promise<void> {
    const users = await purgeStrayCalendarAbsences(this.db);
    users.forEach((u) => this.gameTime.invalidateUserCache(u));
  }
}

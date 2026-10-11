/**
 * ROK-1596 review M1: a row left `disconnecting` (its job lost — Redis down at
 * DELETE, a crash, a flushed queue) still holds a refresh token and is hidden
 * from the overview, so the user cannot retry. Every 15 minutes this re-queues
 * a `disconnect` job for each row `disconnecting` for longer than
 * `STALE_DISCONNECT_MS`. The enqueue helper collapses into a live job and
 * clears a finished one, so a re-queue is idempotent. Runs with the kill
 * switch off too (Q-E: a user can always remove stored credentials).
 */
import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Cron } from '@nestjs/schedule';
import type { Queue } from 'bullmq';
import { and, eq, lt } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { CALENDAR_WRITE_QUEUE } from '../calendar-sync.constants';
import { enqueueCalendarWriteJob } from './calendar-write.enqueue.helpers';

type Db = PostgresJsDatabase<typeof schema>;

export const DISCONNECT_SWEEP_CRON_NAME = 'CalendarDisconnectSweepCron_sweep';
export const STALE_DISCONNECT_MS = 15 * 60 * 1000;

@Injectable()
export class CalendarDisconnectSweepCron {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly cronJobService: CronJobService,
    @InjectQueue(CALENDAR_WRITE_QUEUE) private readonly queue: Queue,
  ) {}

  @Cron('*/15 * * * *', { name: DISCONNECT_SWEEP_CRON_NAME })
  async sweep(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      DISCONNECT_SWEEP_CRON_NAME,
      () => this.run().then(() => undefined),
    );
  }

  /** Returns the connection ids re-queued. */
  async run(now = new Date()): Promise<number[]> {
    const t = schema.calendarConnections;
    const cutoff = new Date(now.getTime() - STALE_DISCONNECT_MS);
    const rows = await this.db
      .select({ id: t.id })
      .from(t)
      .where(and(eq(t.status, 'disconnecting'), lt(t.updatedAt, cutoff)));
    const deps = {
      queue: this.queue,
      isSyncEnabled: () => Promise.resolve(true),
    };
    for (const { id } of rows) {
      await enqueueCalendarWriteJob(deps, {
        kind: 'disconnect',
        connectionId: id,
      });
    }
    return rows.map((r) => r.id);
  }
}

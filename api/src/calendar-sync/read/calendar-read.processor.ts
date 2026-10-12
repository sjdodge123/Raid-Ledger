/**
 * ROK-1593 §3.4: the calendar read worker. It loads the connection, re-checks
 * the kill switch, resolves the read provider and runs one sync
 * (`runCalendarReadSync`). On a throw `recordReadSyncFailure` writes the
 * terminal state (D5) and decides: retryable → rethrow for BullMQ backoff
 * (attempts 4, 60 s exponential); otherwise `UnrecoverableError` (auth →
 * `needs_reconnect`, scope 403 → `read_access_granted=false`, U7).
 */
import { Inject, type OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { type Job, type Queue, UnrecoverableError } from 'bullmq';
import { and, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { QueueHealthService } from '../../queue/queue-health.service';
import { getCalendarSyncEnabled } from '../../settings/settings-calendar-sync.helpers';
import { SettingsService } from '../../settings/settings.service';
import { GameTimeService } from '../../users/game-time.service';
import { CALENDAR_READ_QUEUE } from '../calendar-sync.constants';
import { CalendarProviderRegistry } from '../providers/calendar-provider.registry';
import { isFinalAttempt } from '../write/calendar-write-reconcile-persist.helpers';
import {
  READ_SYNCABLE_STATUSES,
  type CalendarReadJobData,
} from './calendar-read.enqueue.helpers';
import {
  recordReadSyncFailure,
  type ReadFailureDecision,
} from './calendar-read-failure.helpers';
import {
  runCalendarReadSync,
  type ReadSyncOutcome,
} from './calendar-read-sync.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type ReadConnection = typeof schema.calendarConnections.$inferSelect;

/**
 * D11 hook point: a connection just went `needs_reconnect` / `error` (or
 * lost its read grant), so its days must stop counting. PR-B enqueues a
 * `derive` for `userId` here. PR-A: nothing to rebuild yet — busy hours
 * already filter on `status='active' AND read_enabled`.
 */
export function onReadConnectionBroken(
  userId: number,
  decision: ReadFailureDecision,
): Promise<void> {
  void userId;
  void decision;
  return Promise.resolve();
}

@Processor(CALENDAR_READ_QUEUE, { concurrency: 3 })
export class CalendarReadProcessor extends WorkerHost implements OnModuleInit {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly registry: CalendarProviderRegistry,
    private readonly settings: SettingsService,
    private readonly gameTime: GameTimeService,
    @InjectQueue(CALENDAR_READ_QUEUE) private readonly queue: Queue,
    private readonly queueHealth: QueueHealthService,
  ) {
    super();
  }

  /** Registers the queue so `awaitProcessingForTest` drains it. */
  onModuleInit(): void {
    this.queueHealth.register(this.queue);
  }

  async process(job: Job<CalendarReadJobData>): Promise<ReadSyncOutcome> {
    const isEnabled = () => getCalendarSyncEnabled(this.settings);
    if (!(await isEnabled())) return 'skipped';
    const conn = await this.loadConnection(job.data.connectionId);
    if (!conn) return 'skipped';
    const provider = await this.registry.getReadProviderForConnection(conn);
    if (!provider) return 'skipped';
    const deps = {
      db: this.db,
      provider,
      clientUrl: await this.settings.getClientUrl(),
      defaultTimezone: (await this.settings.getDefaultTimezone()) ?? 'UTC',
      stillAllowed: isEnabled,
      onCommitted: (userId: number) =>
        this.gameTime.invalidateUserCache(userId),
    };
    try {
      return await runCalendarReadSync(deps, conn);
    } catch (err) {
      return this.fail(job, conn, err);
    }
  }

  private async fail(
    job: Job<CalendarReadJobData>,
    conn: ReadConnection,
    err: unknown,
  ): Promise<never> {
    const decision = await recordReadSyncFailure(this.db, conn, err, {
      finalAttempt: isFinalAttempt(job),
    });
    if (decision.retry && !isFinalAttempt(job)) throw err;
    this.gameTime.invalidateUserCache(conn.userId);
    await onReadConnectionBroken(conn.userId, decision);
    if (decision.retry) throw err;
    throw new UnrecoverableError(`calendar read sync: ${decision.code}`);
  }

  /** A connection that can sync now: read on, `active` or `error`. */
  private async loadConnection(id: number): Promise<ReadConnection | null> {
    const c = schema.calendarConnections;
    const [row] = await this.db
      .select()
      .from(c)
      .where(
        and(
          eq(c.id, id),
          eq(c.readEnabled, true),
          inArray(c.status, [...READ_SYNCABLE_STATUSES]),
        ),
      )
      .limit(1);
    return row ?? null;
  }
}

/**
 * ROK-1593 §3.4: the calendar read worker. It loads the connection, re-checks
 * the kill switch, resolves the read provider and runs one sync
 * (`runCalendarReadSync`). On a throw `recordReadSyncFailure` writes the
 * terminal state (D5) and decides: retryable → rethrow for BullMQ backoff
 * (attempts 4, 60 s exponential); otherwise `UnrecoverableError` (auth →
 * `needs_reconnect`, scope 403 → `read_access_granted=false`, U7).
 *
 * PR-B: a `derive` job rebuilds one user's synced away days
 * (`runCalendarDerive`) in its own transaction; a successful sync derives in
 * the sync's transaction (`afterBlocks`). A derive failure there (a DB error
 * or a lock-order deadlock) is NOT a provider failure (review MINOR-2): it is
 * tagged `CalendarDeriveError`, never recorded on the connection (no
 * `provider_error` in the UI), logged, and rethrown for a BullMQ retry.
 */
import { Inject, Logger, type OnModuleInit } from '@nestjs/common';
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
import { runCalendarDerive } from './calendar-away-persist.helpers';
import {
  READ_SYNCABLE_STATUSES,
  enqueueCalendarDerive,
  type CalendarReadJobData,
  type CalendarReadQueue,
} from './calendar-read.enqueue.helpers';
import {
  recordReadSyncFailure,
  type ReadFailureDecision,
} from './calendar-read-failure.helpers';
import {
  runCalendarReadSync,
  type ReadSyncOutcome,
  type ReadSyncTx,
} from './calendar-read-sync.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type ReadConnection = typeof schema.calendarConnections.$inferSelect;

/** `derive` = a derive job ran (it never touches a provider). */
export type ReadJobOutcome = ReadSyncOutcome | 'derived';

const logger = new Logger('CalendarReadProcessor');

/** A throw from the in-sync derive — ours, not the provider's (MINOR-2). */
export class CalendarDeriveError extends Error {
  constructor(readonly inner: unknown) {
    super('calendar away-day derive failed');
    this.name = 'CalendarDeriveError';
  }
}

async function deriveInSync(
  tx: ReadSyncTx,
  userId: number,
  defaultTimezone: string,
): Promise<void> {
  try {
    await runCalendarDerive(tx, userId, { defaultTimezone });
  } catch (err) {
    throw new CalendarDeriveError(err);
  }
}

/**
 * D11 / Q12: a read sync failed for good — `needs_reconnect`, lost read
 * grant, or a transient failure backed off (status stays `active`). A broken
 * connection's blocks stop counting, so its away days must go too: enqueue a
 * `derive` for the user (a later successful sync restores them). Best effort
 * — a queue failure is logged and never masks the sync failure.
 */
export async function onReadConnectionBroken(
  queue: CalendarReadQueue,
  userId: number,
  decision: ReadFailureDecision,
): Promise<void> {
  try {
    await enqueueCalendarDerive(queue, userId);
  } catch (err) {
    const name = err instanceof Error ? err.name : 'unknown';
    logger.warn(`derive enqueue after ${decision.code} failed (${name})`);
  }
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

  async process(job: Job<CalendarReadJobData>): Promise<ReadJobOutcome> {
    const isEnabled = () => getCalendarSyncEnabled(this.settings);
    if (!(await isEnabled())) return 'skipped';
    if (job.data.kind === 'derive') return this.derive(job.data.userId);
    const conn = await this.loadConnection(job.data.connectionId);
    if (!conn) return 'skipped';
    const provider = await this.registry.getReadProviderForConnection(conn);
    if (!provider) return 'skipped';
    const defaultTimezone = await this.defaultTimezone();
    const deps = {
      db: this.db,
      provider,
      clientUrl: await this.settings.getClientUrl(),
      defaultTimezone,
      stillAllowed: isEnabled,
      afterBlocks: (tx: ReadSyncTx, userId: number) =>
        deriveInSync(tx, userId, defaultTimezone),
      onCommitted: (userId: number) =>
        this.gameTime.invalidateUserCache(userId),
    };
    try {
      return await runCalendarReadSync(deps, conn);
    } catch (err) {
      return this.fail(job, conn, err);
    }
  }

  /** PR-B (D9): rebuild one user's away days, then drop their cached week. */
  private async derive(userId: number): Promise<'derived'> {
    const defaultTimezone = await this.defaultTimezone();
    await this.db.transaction((tx) =>
      runCalendarDerive(tx, userId, { defaultTimezone }),
    );
    this.gameTime.invalidateUserCache(userId);
    return 'derived';
  }

  private async defaultTimezone(): Promise<string> {
    return (await this.settings.getDefaultTimezone()) ?? 'UTC';
  }

  private async fail(
    job: Job<CalendarReadJobData>,
    conn: ReadConnection,
    err: unknown,
  ): Promise<never> {
    if (err instanceof CalendarDeriveError) {
      const name = err.inner instanceof Error ? err.inner.name : 'unknown';
      logger.error(`away-day derive failed in sync ${conn.id} (${name})`);
      throw err.inner;
    }
    const decision = await recordReadSyncFailure(this.db, conn, err, {
      finalAttempt: isFinalAttempt(job),
    });
    if (decision.retry && !isFinalAttempt(job)) throw err;
    this.gameTime.invalidateUserCache(conn.userId);
    await onReadConnectionBroken(this.queue, conn.userId, decision);
    if (decision.retry) throw err;
    throw new UnrecoverableError(`calendar read sync: ${decision.code}`);
  }

  /** A connection that can sync now: read on and `active`. */
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

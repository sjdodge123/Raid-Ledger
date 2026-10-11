/**
 * ROK-1596 D1: the calendar write worker. Thin — it unpacks the job and calls
 * the reconcile function, which records terminal failures itself and
 * rethrows only retryable ones (BullMQ then backs off: attempts 6, 30s exp).
 * `write-off` runs `runCalendarWriteOff` (A5); `disconnect` runs
 * `runCalendarDisconnect` (A7, D7 — cleanup kinds run with the kill switch off).
 */
import { Inject, type OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { QueueHealthService } from '../../queue/queue-health.service';
import { getCalendarSyncEnabled } from '../../settings/settings-calendar-sync.helpers';
import { SettingsService } from '../../settings/settings.service';
import { CALENDAR_WRITE_QUEUE } from '../calendar-sync.constants';
import { CalendarProviderRegistry } from '../providers/calendar-provider.registry';
import type { CalendarWriteJobData } from './calendar-write.enqueue.helpers';
import {
  type CalendarReconcileDeps,
  reconcileCalendarCopy,
  type ReconcileOutcome,
} from './calendar-write-reconcile.helpers';
import {
  type CalendarDisconnectResult,
  runCalendarDisconnect,
} from '../services/calendar-disconnect.helpers';
import {
  runCalendarWriteOff,
  type WriteOffOutcome,
} from './calendar-write-off.helpers';

@Processor(CALENDAR_WRITE_QUEUE, { concurrency: 2 })
export class CalendarWriteProcessor extends WorkerHost implements OnModuleInit {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly registry: CalendarProviderRegistry,
    private readonly settings: SettingsService,
    @InjectQueue(CALENDAR_WRITE_QUEUE) private readonly queue: Queue,
    private readonly queueHealth: QueueHealthService,
  ) {
    super();
  }

  /** Registers the queue so `awaitProcessingForTest` drains it. */
  onModuleInit(): void {
    this.queueHealth.register(this.queue);
  }

  /** The reconcile function's dependencies (also used by its specs). */
  reconcileDeps(): CalendarReconcileDeps {
    return {
      db: this.db,
      registry: this.registry,
      isSyncEnabled: () => getCalendarSyncEnabled(this.settings),
      getClientUrl: () => this.settings.getClientUrl(),
    };
  }

  async process(
    job: Job<CalendarWriteJobData>,
  ): Promise<ReconcileOutcome | WriteOffOutcome | CalendarDisconnectResult> {
    const { data } = job;
    const deps = { db: this.db, registry: this.registry };
    if (data.kind === 'write-off') {
      return runCalendarWriteOff(deps, data.connectionId);
    }
    if (data.kind === 'disconnect') {
      return runCalendarDisconnect(deps, data.connectionId);
    }
    return reconcileCalendarCopy(this.reconcileDeps(), data);
  }
}

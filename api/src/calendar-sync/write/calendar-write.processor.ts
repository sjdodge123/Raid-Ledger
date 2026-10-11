/**
 * ROK-1596 D1: the calendar write worker. Thin — it unpacks the job and calls
 * the reconcile function, which records terminal failures itself and
 * rethrows only retryable ones (BullMQ then backs off: attempts 6, 30s exp).
 * `write-off` / `disconnect` kinds land with lanes A5/A6.
 */
import { Inject, Logger, type OnModuleInit } from '@nestjs/common';
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

@Processor(CALENDAR_WRITE_QUEUE, { concurrency: 2 })
export class CalendarWriteProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(CalendarWriteProcessor.name);

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
  ): Promise<ReconcileOutcome | null> {
    const { data } = job;
    if (data.kind !== 'reconcile') {
      this.logger.warn(
        `calendar-write job kind ${data.kind} is not handled yet`,
      );
      return null;
    }
    return reconcileCalendarCopy(this.reconcileDeps(), data);
  }
}

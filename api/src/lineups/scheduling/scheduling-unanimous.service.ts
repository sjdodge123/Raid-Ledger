/**
 * ROK-1632 AC3 — DM the poll's creator when ONE proposed time has a yes from
 * every member. STUB (red): behaviour lands in the next commit.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { NotificationService } from '../../notifications/notification.service';
import { NotificationDedupService } from '../../notifications/notification-dedup.service';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { SettingsService } from '../../settings/settings.service';

@Injectable()
export class SchedulingUnanimousService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly notificationService: NotificationService,
    private readonly dedupService: NotificationDedupService,
    private readonly settingsService: SettingsService,
    private readonly cronJobService: CronJobService,
  ) {}

  /** Stub. */
  async checkMatch(_matchId: number | null): Promise<number> {
    return 0;
  }

  /** Stub. */
  async handleSweep(): Promise<void> {
    return undefined;
  }
}

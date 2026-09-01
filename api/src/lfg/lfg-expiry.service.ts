/**
 * Hourly expiry sweep for LFG intents (ROK-1451, AC9).
 *
 * Hygiene only — every read already filters on `expires_at`, so a not-yet-swept
 * row can never inflate a count. Hourly rather than daily so the board does not
 * carry visibly dead rows for up to a day.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { CronJobService } from '../cron-jobs/cron-job.service';
import {
  LFG_EXPIRY_CRON_EXPRESSION,
  LFG_EXPIRY_JOB_NAME,
} from './lfg.constants';
import { expireStaleIntents } from './lfg-write.helpers';

@Injectable()
export class LfgExpiryService {
  private readonly logger = new Logger(LfgExpiryService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly cronJobService: CronJobService,
  ) {}

  /** Flip every past-`expires_at` active intent to `expired`. */
  // waitForCompletion: a sweep that mutates rows must never overlap itself,
  // and it makes `fireOnTick()` actually await the handler.
  @Cron(LFG_EXPIRY_CRON_EXPRESSION, {
    name: LFG_EXPIRY_JOB_NAME,
    waitForCompletion: true,
  })
  async expireIntents(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      LFG_EXPIRY_JOB_NAME,
      async () => {
        const expired = await expireStaleIntents(this.db);
        if (expired === 0) return false;
        this.logger.log(`Expired ${expired} LFG intents`);
      },
    );
  }
}

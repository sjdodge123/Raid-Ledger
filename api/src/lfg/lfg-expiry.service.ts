/**
 * Hourly expiry sweep for LFG intents (ROK-1451, AC9).
 *
 * Hygiene only — every read already filters on `expires_at`, so a not-yet-swept
 * row can never inflate a count. Hourly rather than daily so the board does not
 * carry visibly dead rows for up to a day.
 *
 * ROK-1454 D2: the sweep also ANNOUNCES itself. It is the only thing that knows
 * a group died of old age, so a consumer rendering that group has no other way
 * to learn it is over.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { CronJobService } from '../cron-jobs/cron-job.service';
import {
  LFG_EVENTS,
  LFG_EXPIRY_CRON_EXPRESSION,
  LFG_EXPIRY_JOB_NAME,
  type LfgGroupChangedPayload,
} from './lfg.constants';
import { expireStaleIntents } from './lfg-write.helpers';

@Injectable()
export class LfgExpiryService {
  private readonly logger = new Logger(LfgExpiryService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly cronJobService: CronJobService,
    private readonly eventEmitter: EventEmitter2,
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
        const { count, gameIds } = await expireStaleIntents(this.db);
        if (count === 0) return false;
        this.logger.log(`Expired ${count} LFG intents`);
        this.announceExpiredGroups(gameIds);
      },
    );
  }

  /**
   * Emit one `GROUP_CHANGED` per DISTINCT game the sweep touched (D2 / E10).
   *
   * Per game rather than per row: a 40-row sweep across three groups is three
   * embed edits. Runs after the UPDATE has settled, so a consumer that re-reads
   * can never observe a row the sweep had not yet flipped.
   *
   * @param gameIds - Distinct games whose groups just expired.
   */
  private announceExpiredGroups(gameIds: number[]): void {
    for (const gameId of gameIds) {
      const payload: LfgGroupChangedPayload = { gameId, reason: 'expired' };
      this.eventEmitter.emit(LFG_EVENTS.GROUP_CHANGED, payload);
    }
  }
}

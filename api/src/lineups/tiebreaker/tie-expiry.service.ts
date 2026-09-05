/**
 * ROK-1374 — daily sweep for expired tie holds (D13, E12, AC18).
 *
 * Follows `LfgExpiryService` exactly: one `@Cron` wrapping one
 * `executeWithTracking` call so the admin cron dashboard sees the run, its
 * duration and its failures. Daily rather than hourly — the window is a week
 * wide and each expiry fans out DMs.
 *
 * `sweep` returns the ids it expired so the notification wiring (Lane B's
 * `notifyTieExpired` + the announce-message edit) has a single, once-only
 * trigger. The sweep itself deliberately sends nothing: `expireTieHold` is the
 * edge, and keeping dispatch outside the transactional path means a Discord
 * outage can never leave a row unexpired.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { ActivityActionDto } from '@raid-ledger/contract';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import {
  TIE_EXPIRY_CRON_EXPRESSION,
  TIE_EXPIRY_JOB_NAME,
  sweepExpiredTieHolds,
  type TieExpirySweepResult,
} from './tie-expiry.helpers';

/**
 * TODO(ROK-1374 C1): `tie_expired` is not yet a member of
 * `ActivityActionSchema` (`packages/contract/src/activity-log.schema.ts:8`);
 * Lane C1 owns that file this cycle. The assertion is confined to this one
 * constant so the swap is a one-line deletion, and the column is plain `text`
 * so the row is valid the moment the enum catches up.
 */
const TIE_EXPIRED_ACTION = 'tie_expired' as ActivityActionDto;

@Injectable()
export class TieExpiryService {
  private readonly logger = new Logger(TieExpiryService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly activityLog: ActivityLogService,
    private readonly cronJobService: CronJobService,
  ) {}

  /** Archive every tie hold that has run out its week. Never decides. */
  // waitForCompletion: a sweep that mutates rows must never overlap itself.
  @Cron(TIE_EXPIRY_CRON_EXPRESSION, {
    name: TIE_EXPIRY_JOB_NAME,
    waitForCompletion: true,
  })
  async expireTieHolds(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      TIE_EXPIRY_JOB_NAME,
      async () => {
        const { expired } = await this.sweep();
        if (expired.length === 0) return false;
        this.logger.log(
          `Expired ${expired.length} tie hold(s): ${expired.join(', ')}`,
        );
      },
    );
  }

  /**
   * Run one sweep. Exposed (and returning the ids) so integration tests can
   * drive it deterministically and so the Lead can wire notifications off the
   * expired list without reaching into the cron wrapper.
   */
  async sweep(now: Date = new Date()): Promise<TieExpirySweepResult> {
    return sweepExpiredTieHolds(this.db, now, {
      logExpiry: (lineupId) => this.logExpiry(lineupId, now),
    });
  }

  /**
   * `actorId` is null on purpose: nobody expired this lineup. An actor here
   * would be a lie, and the timeline is where that lie would be believed.
   */
  private async logExpiry(lineupId: number, now: Date): Promise<void> {
    await this.activityLog.log('lineup', lineupId, TIE_EXPIRED_ACTION, null, {
      expiredAt: now.toISOString(),
    });
  }
}

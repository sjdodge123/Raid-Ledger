/**
 * ROK-1632 AC3 — "everyone picked this time" creator DM.
 *
 * When ONE proposed time of a live poll holds a `yes` from every member of the
 * match (n > 1), the lineup's creator gets a DM naming that time with a
 * one-tap Lock button. Once per poll per time, forever.
 *
 * Two triggers, one method:
 * 1. **Inline** — `SchedulingService.toggleVote` calls `checkMatch(matchId)`
 *    post-commit and un-awaited, so the vote that completed the set announces
 *    itself immediately without costing the request any latency.
 * 2. **Cron** — a 5-minute sweep (`checkMatch(null)`) is the retry for a DM
 *    whose send threw, and the only trigger for a slot that goes unanimous
 *    without a vote (a member being removed).
 *
 * Both claim the same permanent `notification_dedup` key first, and the claim
 * is an atomic `ON CONFLICT DO NOTHING` insert, so a double DM is impossible.
 * The claim is given back ONLY when the send threw: a `create` that RESOLVES
 * null (the recipient's prefs suppress the category) is a decided outcome and
 * keeps the claim, or every tick would re-send forever.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { NotificationService } from '../../notifications/notification.service';
import { NotificationDedupService } from '../../notifications/notification-dedup.service';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { SettingsService } from '../../settings/settings.service';
import {
  UNANIMOUS_SLOTS_QUERY,
  buildUnanimousNotification,
  unanimousDedupKey,
  type UnanimousSlotRow,
} from './scheduling-unanimous.helpers';

const JOB_NAME = 'SchedulingUnanimousService_sweep';

/** Message of an unknown throwable, for the log line. */
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

@Injectable()
export class SchedulingUnanimousService {
  private readonly logger = new Logger(SchedulingUnanimousService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly notificationService: NotificationService,
    private readonly dedupService: NotificationDedupService,
    private readonly settingsService: SettingsService,
    private readonly cronJobService: CronJobService,
  ) {}

  /**
   * Cron safety net: sweep every open poll.
   *
   * Returns `false` from the tracked body on an idle tick so no execution row
   * is recorded (the `SchedulingPollExpiryService` convention).
   */
  @Cron('0 */5 * * * *', { name: JOB_NAME })
  async handleSweep(): Promise<void> {
    await this.cronJobService.executeWithTracking(JOB_NAME, async () => {
      const sent = await this.checkMatch(null);
      if (sent === 0) return false;
      this.logger.log(`Unanimous sweep: ${sent} creator DM(s)`);
      return true;
    });
  }

  /**
   * DM the creator for every not-yet-announced unanimous slot.
   *
   * NEVER throws: the inline caller does not await it, and a failure here must
   * not reach the voter. Per-row failures are isolated so one bad DM cannot
   * starve the next slot.
   *
   * @param matchId - One poll (the inline hook), or `null` to sweep them all.
   * @returns How many DMs were created this pass.
   */
  async checkMatch(matchId: number | null): Promise<number> {
    try {
      const rows = (await this.db.execute(
        UNANIMOUS_SLOTS_QUERY(matchId),
      )) as unknown as UnanimousSlotRow[];
      if (rows.length === 0) return 0;
      const timeZone =
        (await this.settingsService.getDefaultTimezone()) ?? 'UTC';
      return await this.notifyRows(rows, timeZone);
    } catch (err) {
      this.logger.warn(
        `Unanimous check failed for match ${matchId ?? 'all'}: ${errMsg(err)}`,
      );
      return 0;
    }
  }

  /**
   * Send each row's DM, isolating per-row failures. At most ONE DM per poll
   * per pass: rows arrive earliest time first, and once a poll has been
   * announced this pass its later times ride the next vote or the next tick.
   * A row that was already claimed on an earlier pass sends nothing and does
   * NOT count, so the time behind it is never starved (Codex pass 2).
   */
  private async notifyRows(
    rows: UnanimousSlotRow[],
    timeZone: string,
  ): Promise<number> {
    let sent = 0;
    const announced = new Set<number>();
    for (const row of rows) {
      if (announced.has(row.matchId)) continue;
      try {
        if (await this.notifyOne(row, timeZone)) {
          sent++;
          announced.add(row.matchId);
        }
      } catch (err) {
        this.logger.warn(
          `Unanimous DM failed for match ${row.matchId} slot ${row.slotId}: ` +
            errMsg(err),
        );
      }
    }
    return sent;
  }

  /**
   * Claim the key, then send. A throw gives the claim back so the next vote
   * or the next cron tick retries; a resolved send keeps it forever.
   *
   * @param row - One unanimous slot.
   * @param timeZone - Community default, for the Lock button's label.
   * @returns True when a notification was created.
   */
  private async notifyOne(
    row: UnanimousSlotRow,
    timeZone: string,
  ): Promise<boolean> {
    const key = unanimousDedupKey(row.matchId, row.slotId);
    if (await this.dedupService.checkAndMarkSent(key, null)) return false;
    try {
      await this.notificationService.create(
        buildUnanimousNotification(row, timeZone),
      );
    } catch (err) {
      // A release that throws too (Redis/DB down) must not replace the send
      // error: the log would name the wrong outage and the caller's isolation
      // would report a failure the operator cannot act on.
      try {
        await this.dedupService.releaseKey(key);
      } catch (releaseErr) {
        this.logger.warn(
          `Unanimous claim ${key} could not be released: ` + errMsg(releaseErr),
        );
      }
      throw err;
    }
    return true;
  }
}

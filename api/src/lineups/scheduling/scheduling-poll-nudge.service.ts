/**
 * Recurring 24h vote nudge for scheduling polls.
 *
 * Members of an active poll who have not voted on any still-viable day get a
 * DM every 24 hours until they vote or the poll closes. Complements the
 * deadline-driven reminders (`StandalonePollReminderService`,
 * `LineupReminderService.checkSchedulingReminders`), which only fire when a
 * `phase_deadline` is within 24h — deadline-less polls previously lingered
 * with no follow-up at all.
 *
 * Lives in the scheduling module because it serves standalone AND regular
 * matches. Recurrence is the dedup key's TTL (fixed expiry + lazy re-insert),
 * so no new table is needed.
 *
 * Dedup key shape: `sched-poll-nudge:{matchId}:{userId}`
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { NotificationService } from '../../notifications/notification.service';
import { NotificationDedupService } from '../../notifications/notification-dedup.service';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import {
  findNudgeablePolls,
  findPendingMemberIds,
  sendPollNudge,
  type NudgePoll,
} from './scheduling-poll-nudge.helpers';

const JOB_NAME = 'SchedulingPollNudgeService_runNudges';

@Injectable()
export class SchedulingPollNudgeService {
  private readonly logger = new Logger(SchedulingPollNudgeService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly notificationService: NotificationService,
    private readonly dedupService: NotificationDedupService,
    private readonly cronJobService: CronJobService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: JOB_NAME })
  async handleCron(): Promise<void> {
    await this.cronJobService.executeWithTracking(JOB_NAME, () =>
      this.runNudges(),
    );
  }

  /**
   * Nudge every pending member of every eligible scheduling poll.
   *
   * @returns `false` only on a genuinely idle tick (nothing sent AND nothing
   *   failed) so no execution row is recorded; `{ degraded: true }` when any
   *   poll threw so a dispatch outage shows as degraded in the admin cron
   *   panel instead of reading as healthy (ROK-1197 marker).
   */
  async runNudges(): Promise<void | false | { degraded: true }> {
    const polls = await findNudgeablePolls(this.db);
    if (polls.length === 0) return false;

    let sent = 0;
    let failed = 0;
    for (const poll of polls) {
      try {
        sent += await this.processPoll(poll);
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Poll nudge failed for match ${poll.matchId}: ${msg}`);
      }
    }
    if (sent === 0 && failed === 0) return false;
    this.logger.log(
      `Scheduling poll nudges: ${sent} sent across ${polls.length} polls` +
        (failed > 0 ? `, ${failed} poll(s) failed` : ''),
    );
    if (failed > 0) return { degraded: true };
  }

  /**
   * Fan the nudge out to one poll's pending members.
   *
   * @returns Number of DMs actually created (dedup skips are not counted)
   */
  private async processPoll(poll: NudgePoll): Promise<number> {
    const userIds = await findPendingMemberIds(
      this.db,
      poll.matchId,
      poll.inDeadlineHandoff,
    );
    let sent = 0;
    for (const userId of userIds) {
      if (await this.sendNudge(poll, userId)) sent++;
    }
    return sent;
  }

  /**
   * Send one nudge unless this (match, user) pair was already nudged inside
   * the current 24h window.
   *
   * Delegates to the shared `sendPollNudge` (ROK-1618) so the cron and the
   * organiser "Rally" cannot drift on the dedup key, the copy or the payload.
   *
   * @returns True when this call claimed the member's 24h window
   */
  private async sendNudge(poll: NudgePoll, userId: number): Promise<boolean> {
    const { dispatched } = await sendPollNudge(
      {
        notificationService: this.notificationService,
        dedupService: this.dedupService,
      },
      poll,
      userId,
    );
    return dispatched;
  }
}

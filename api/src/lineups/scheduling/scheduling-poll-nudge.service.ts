/**
 * Recurring 48h vote nudge for scheduling polls.
 *
 * Members of an active poll who have not voted on any still-viable day get a
 * DM every 48 hours until they vote or the poll closes. Complements the
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
import { POLL_NUDGE_TTL_SECONDS } from '../lineup-notification.constants';
import {
  buildNudgeCopy,
  findNudgeablePolls,
  findPendingMemberIds,
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
   * the current 48h window.
   *
   * @returns True when a notification was created
   */
  private async sendNudge(poll: NudgePoll, userId: number): Promise<boolean> {
    const key = `sched-poll-nudge:${poll.matchId}:${userId}`;
    const alreadySent = await this.dedupService.checkAndMarkSent(
      key,
      POLL_NUDGE_TTL_SECONDS,
    );
    if (alreadySent) return false;

    const { title, message } = buildNudgeCopy(poll);
    await this.notificationService.create({
      userId,
      type: 'community_lineup',
      title,
      message,
      payload: {
        // Own 5-min rate-limit bucket, distinct from the deadline reminder.
        subtype: 'scheduling_poll_nudge',
        // Per-poll rate bucket: a user pending in N polls gets N DMs (each a
        // different deep link) instead of 1 DM + N-1 silently dropped — dedup
        // is marked pre-dispatch, so a dropped DM is lost for the whole window.
        reminderWindow: `poll-${poll.matchId}`,
        lineupId: poll.lineupId,
        matchId: poll.matchId,
        gameName: poll.gameName,
      },
    });
    return true;
  }
}

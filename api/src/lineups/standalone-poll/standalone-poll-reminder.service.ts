/**
 * Standalone scheduling poll deadline reminders (ROK-1192).
 *
 * Sends 24h + 1h DMs to non-voters before a standalone poll's
 * `phase_deadline`. Distinct from `LineupReminderService` because
 * standalone polls live in `decided` state with
 * `phase_duration_override.standalone = true`, which the existing
 * scheduling-reminder query explicitly excludes.
 *
 * Dedup key shape: `standalone-poll-reminder:{matchId}:{userId}:{window}`
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { NotificationService } from '../../notifications/notification.service';
import { NotificationDedupService } from '../../notifications/notification-dedup.service';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { DEDUP_TTL } from '../lineup-notification.constants';

interface ActiveStandalonePoll {
  lineupId: number;
  matchId: number;
  phaseDeadline: Date;
}

interface StandaloneNonVoter {
  userId: number;
}

const MS_PER_HOUR = 3_600_000;

/**
 * `phase_deadline` is a `timestamp without time zone` column. postgres-js
 * returns it as a naïve string ("YYYY-MM-DD HH:MM:SS.SSS") which `new Date()`
 * would parse in the runtime's local TZ, shifting the value by hours. We
 * INSERT JS Dates as UTC, so re-parse with an explicit UTC suffix.
 */
function parseTimestampUtc(value: Date | string): Date {
  if (value instanceof Date) return value;
  const s = String(value);
  if (s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s);
  return new Date(s.replace(' ', 'T') + 'Z');
}

@Injectable()
export class StandalonePollReminderService {
  private readonly logger = new Logger(StandalonePollReminderService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly notificationService: NotificationService,
    private readonly dedupService: NotificationDedupService,
    private readonly cronJobService: CronJobService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, {
    name: 'StandalonePollReminderService_runReminders',
  })
  async handleCron(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'StandalonePollReminderService_runReminders',
      () => this.runReminders(),
    );
  }

  /** Process every active standalone poll for reminder dispatch. */
  async runReminders(): Promise<void> {
    const polls = await this.findActivePolls();
    for (const poll of polls) {
      try {
        await this.processPoll(poll);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Standalone reminder failed for lineup ${poll.lineupId}: ${msg}`,
        );
      }
    }
  }

  /** Process one poll: classify window, fan out DMs to non-voters. */
  private async processPoll(poll: ActiveStandalonePoll): Promise<void> {
    const window = this.classifyWindow(poll.phaseDeadline);
    if (!window) return;
    const nonVoters = await this.findNonVoters(poll.matchId);
    for (const v of nonVoters) {
      await this.sendReminder(poll, v.userId, window);
    }
  }

  /** Decide which reminder window applies, or null if outside both. */
  private classifyWindow(deadline: Date): '24h' | '1h' | null {
    const hoursLeft = (deadline.getTime() - Date.now()) / MS_PER_HOUR;
    if (hoursLeft <= 0 || hoursLeft > 24) return null;
    return hoursLeft <= 1 ? '1h' : '24h';
  }

  /** Send one reminder DM if dedup hasn't already marked it sent. */
  private async sendReminder(
    poll: ActiveStandalonePoll,
    userId: number,
    window: '24h' | '1h',
  ): Promise<void> {
    const key = `standalone-poll-reminder:${poll.matchId}:${userId}:${window}`;
    if (await this.dedupService.checkAndMarkSent(key, DEDUP_TTL)) return;

    const { title, message } = this.buildCopy(window);
    await this.notificationService.create({
      userId,
      type: 'community_lineup',
      title,
      message,
      payload: {
        subtype: 'standalone_scheduling_poll_reminder',
        lineupId: poll.lineupId,
        matchId: poll.matchId,
        window,
      },
    });
  }

  /** Title + message copy for the reminder window. */
  private buildCopy(window: '24h' | '1h'): { title: string; message: string } {
    if (window === '1h') {
      return {
        title: 'Scheduling poll closing now',
        message:
          'Your scheduling poll closes in 1 hour — vote on a time before it locks.',
      };
    }
    return {
      title: 'Scheduling poll closing soon (24 hours)',
      message:
        "You haven't voted on a time yet — the scheduling poll closes in 24 hours.",
    };
  }

  /**
   * Active standalone polls = decided community lineups whose
   * `phase_duration_override->>'standalone'` is `'true'`, with a
   * non-null `phase_deadline` and a `scheduling` match attached.
   */
  private async findActivePolls(): Promise<ActiveStandalonePoll[]> {
    const rows = (await this.db.execute(sql`
      SELECT cl.id AS "lineupId",
             clm.id AS "matchId",
             cl.phase_deadline AS "phaseDeadline"
      FROM community_lineups cl
      JOIN community_lineup_matches clm ON clm.lineup_id = cl.id
      WHERE cl.status = 'decided'
        AND cl.phase_duration_override->>'standalone' = 'true'
        AND cl.phase_deadline IS NOT NULL
        AND clm.status = 'scheduling'
    `)) as unknown as Array<{
      lineupId: number;
      matchId: number;
      phaseDeadline: Date | string;
    }>;
    return rows.map((r) => ({
      lineupId: r.lineupId,
      matchId: r.matchId,
      phaseDeadline: parseTimestampUtc(r.phaseDeadline),
    }));
  }

  /** Match members who haven't voted on any schedule slot for this match. */
  private async findNonVoters(matchId: number): Promise<StandaloneNonVoter[]> {
    return (await this.db.execute(sql`
      SELECT lmm.user_id AS "userId"
      FROM community_lineup_match_members lmm
      WHERE lmm.match_id = ${matchId}
        AND NOT EXISTS (
          SELECT 1
          FROM community_lineup_schedule_votes csv
          JOIN community_lineup_schedule_slots css
            ON css.id = csv.slot_id
          WHERE css.match_id = lmm.match_id
            AND csv.user_id = lmm.user_id
        )
    `)) as unknown as StandaloneNonVoter[];
  }
}

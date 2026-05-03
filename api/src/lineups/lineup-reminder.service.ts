/**
 * Cron-driven reminder service for Community Lineup
 * (ROK-932 / ROK-1117 / ROK-1126).
 *
 * Sends nomination reminders (24h + 1h before building deadline),
 * vote reminders (24h + 1h before voting deadline), scheduling
 * reminders (24h + 1h before decided phase end), and tiebreaker
 * reminders (24h + 1h before round deadline). Recipient resolution
 * for nominate / vote / schedule is delegated to
 * `resolveLineupReminderTargets`, which applies the public/private +
 * already-participated filter.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { NotificationService } from '../notifications/notification.service';
import { NotificationDedupService } from '../notifications/notification-dedup.service';
import { SettingsService } from '../settings/settings.service';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { DEDUP_TTL } from './lineup-notification.constants';
import {
  findActiveTiebreakersWithDeadline,
  resolveReminderTargets,
  classifyThreshold,
  buildTiebreakerReminderMessage,
  type ActiveTiebreakerRow,
} from './lineup-tiebreaker-reminder.helpers';
import { resolveLineupReminderTargets } from './lineup-reminder-target.helpers';

interface ReminderLineup {
  id: number;
  status: string;
  phaseDeadline: Date | string | null;
  votingDeadline?: Date | string | null;
}

interface SchedulingMatchRef {
  lineupId: number;
  matchId: number;
}

const MS_PER_HOUR = 3600_000;

/**
 * `phase_deadline` is `timestamp without time zone`. postgres-js returns
 * it as a naïve string; `new Date()` would parse in local TZ. We INSERT
 * JS Dates as UTC, so re-parse with an explicit UTC suffix.
 */
function parseTimestampUtc(value: Date | string): Date {
  if (value instanceof Date) return value;
  const s = String(value);
  if (s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s);
  return new Date(s.replace(' ', 'T') + 'Z');
}

@Injectable()
export class LineupReminderService {
  private readonly logger = new Logger(LineupReminderService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly notificationService: NotificationService,
    private readonly dedupService: NotificationDedupService,
    private readonly settingsService: SettingsService,
    private readonly cronJobService: CronJobService,
  ) {}

  /** Send vote reminders for active voting lineups (24h + 1h windows). */
  @Cron(CronExpression.EVERY_5_MINUTES, {
    name: 'LineupReminderService_checkVoteReminders',
  })
  async checkVoteReminders(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'LineupReminderService_checkVoteReminders',
      () => this.runVoteReminders(),
    );
  }

  /** Send scheduling reminders for active decided lineups (24h + 1h windows). */
  @Cron(CronExpression.EVERY_5_MINUTES, {
    name: 'LineupReminderService_checkSchedulingReminders',
  })
  async checkSchedulingReminders(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'LineupReminderService_checkSchedulingReminders',
      () => this.runSchedulingReminders(),
    );
  }

  /** Send nomination reminders for active building lineups (ROK-1126). */
  @Cron(CronExpression.EVERY_5_MINUTES, {
    name: 'LineupReminderService_checkNominationReminders',
  })
  async checkNominationReminders(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'LineupReminderService_checkNominationReminders',
      () => this.runNominationReminders(),
    );
  }

  /** Send tiebreaker reminders for active tiebreakers approaching round deadline. */
  @Cron(CronExpression.EVERY_5_MINUTES, {
    name: 'LineupReminderService_checkTiebreakerReminders',
  })
  async checkTiebreakerReminders(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'LineupReminderService_checkTiebreakerReminders',
      () => this.runTiebreakerReminders(),
    );
  }

  // ─── Inner runners (wrapped by executeWithTracking) ──────────

  private async runVoteReminders(): Promise<void> {
    const lineups = await this.getVotingLineups();
    for (const lineup of lineups) {
      await this.processVoteReminder(lineup);
    }
  }

  private async runSchedulingReminders(): Promise<void> {
    const lineups = await this.getDecidedLineups();
    for (const lineup of lineups) {
      await this.processSchedulingReminder(lineup);
    }
  }

  private async runNominationReminders(): Promise<void> {
    const lineups = await this.getBuildingLineups();
    for (const lineup of lineups) {
      await this.processNominationReminder(lineup);
    }
  }

  private async runTiebreakerReminders(): Promise<void> {
    const tiebreakers = await findActiveTiebreakersWithDeadline(this.db);
    for (const tb of tiebreakers) {
      try {
        await this.processTiebreakerReminder(tb);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Tiebreaker reminder failed for tb ${tb.tiebreakerId} (lineup ${tb.lineupId}): ${msg}`,
        );
      }
    }
  }

  // ─── Per-lineup processors ───────────────────────────────────

  private async processVoteReminder(lineup: ReminderLineup): Promise<void> {
    const deadline = lineup.phaseDeadline ?? lineup.votingDeadline;
    if (!deadline) return;
    const window = this.classifyWindow(deadline);
    if (!window) return;
    const userIds = await resolveLineupReminderTargets(
      this.db,
      lineup.id,
      'vote',
    );
    for (const userId of userIds) {
      await this.sendVoteReminder(lineup.id, userId, window);
    }
  }

  private async processSchedulingReminder(
    lineup: ReminderLineup,
  ): Promise<void> {
    if (!lineup.phaseDeadline) return;
    const window = this.classifyWindow(lineup.phaseDeadline);
    if (!window) return;
    const matches = await this.getSchedulingMatches(lineup.id);
    for (const match of matches) {
      const userIds = await resolveLineupReminderTargets(
        this.db,
        lineup.id,
        'schedule',
        match.matchId,
      );
      for (const userId of userIds) {
        await this.sendSchedulingReminder(match.matchId, userId, window);
      }
    }
  }

  private async processNominationReminder(
    lineup: ReminderLineup,
  ): Promise<void> {
    if (!lineup.phaseDeadline) return;
    const window = this.classifyWindow(lineup.phaseDeadline);
    if (!window) return;
    const userIds = await resolveLineupReminderTargets(
      this.db,
      lineup.id,
      'nominate',
    );
    for (const userId of userIds) {
      await this.sendNominationReminder(lineup.id, userId, window);
    }
  }

  private async processTiebreakerReminder(
    tb: ActiveTiebreakerRow,
  ): Promise<void> {
    const threshold = classifyThreshold(this.hoursUntil(tb.roundDeadline));
    if (!threshold) return;
    const userIds = await resolveReminderTargets(this.db, tb);
    for (const userId of userIds) {
      await this.sendTiebreakerReminder(tb, userId, threshold);
    }
  }

  // ─── DM dispatch ─────────────────────────────────────────────

  private async sendVoteReminder(
    lineupId: number,
    userId: number,
    window: '24h' | '1h',
  ): Promise<void> {
    const key = `lineup-reminder-${window}:${lineupId}:${userId}`;
    if (await this.dedupService.checkAndMarkSent(key, DEDUP_TTL)) return;
    const message =
      window === '1h'
        ? 'Last chance to vote -- voting closes in 1 hour'
        : "You haven't voted yet -- voting closes in 24 hours";
    await this.notificationService.create({
      userId,
      type: 'community_lineup',
      title: 'Vote Reminder',
      message,
      payload: { subtype: 'lineup_vote_reminder', lineupId },
    });
  }

  private async sendSchedulingReminder(
    matchId: number,
    userId: number,
    window: '24h' | '1h',
  ): Promise<void> {
    const key = `lineup-sched-remind:${matchId}:${userId}:${window}`;
    if (await this.dedupService.checkAndMarkSent(key, DEDUP_TTL)) return;
    await this.notificationService.create({
      userId,
      type: 'community_lineup',
      title: 'Scheduling Reminder',
      message: 'Your match is waiting -- pick a time!',
      payload: { subtype: 'lineup_scheduling_reminder', matchId },
    });
  }

  private async sendNominationReminder(
    lineupId: number,
    userId: number,
    window: '24h' | '1h',
  ): Promise<void> {
    const key = `lineup-nominate-remind:${lineupId}:${userId}:${window}`;
    if (await this.dedupService.checkAndMarkSent(key, DEDUP_TTL)) return;
    const message =
      window === '1h'
        ? 'Last chance to nominate -- the building phase closes in 1 hour'
        : 'Nominations are closing in 24 hours -- add your picks before the cut';
    await this.notificationService.create({
      userId,
      type: 'community_lineup',
      title: 'Nomination Reminder',
      message,
      payload: { subtype: 'lineup_nominate_reminder', lineupId },
    });
  }

  private async sendTiebreakerReminder(
    tb: ActiveTiebreakerRow,
    userId: number,
    threshold: '24h' | '1h',
  ): Promise<void> {
    const key = `tiebreaker-reminder:${tb.tiebreakerId}:${threshold}:${userId}`;
    if (await this.dedupService.checkAndMarkSent(key, DEDUP_TTL)) return;
    const clientUrl = await this.settingsService.getClientUrl();
    const message = await buildTiebreakerReminderMessage(
      this.db,
      tb,
      threshold,
      clientUrl,
    );
    await this.notificationService.create({
      userId,
      type: 'community_lineup',
      title: 'Tiebreaker Reminder',
      message,
      payload: {
        subtype: 'lineup_tiebreaker_reminder',
        lineupId: tb.lineupId,
        tiebreakerId: tb.tiebreakerId,
        mode: tb.mode,
        threshold,
      },
    });
  }

  // ─── Utilities ───────────────────────────────────────────────

  private hoursUntil(deadline: Date | string): number {
    return (parseTimestampUtc(deadline).getTime() - Date.now()) / MS_PER_HOUR;
  }

  private classifyWindow(deadline: Date | string): '24h' | '1h' | null {
    const hoursLeft = this.hoursUntil(deadline);
    if (hoursLeft <= 0 || hoursLeft > 24) return null;
    return hoursLeft <= 1 ? '1h' : '24h';
  }

  // ─── DB queries ──────────────────────────────────────────────

  private async getVotingLineups(): Promise<ReminderLineup[]> {
    return (await this.db.execute(sql`
      SELECT id, status, phase_deadline AS "phaseDeadline",
             phase_deadline AS "votingDeadline"
      FROM community_lineups
      WHERE status = 'voting'
    `)) as unknown as ReminderLineup[];
  }

  private async getDecidedLineups(): Promise<ReminderLineup[]> {
    return (await this.db.execute(sql`
      SELECT id, status, phase_deadline AS "phaseDeadline"
      FROM community_lineups
      WHERE status = 'decided'
        AND (phase_duration_override IS NULL OR phase_duration_override->>'standalone' IS NULL)
    `)) as unknown as ReminderLineup[];
  }

  private async getBuildingLineups(): Promise<ReminderLineup[]> {
    return (await this.db.execute(sql`
      SELECT id, status, phase_deadline AS "phaseDeadline"
      FROM community_lineups
      WHERE status = 'building'
        AND phase_deadline IS NOT NULL
    `)) as unknown as ReminderLineup[];
  }

  private async getSchedulingMatches(
    lineupId: number,
  ): Promise<SchedulingMatchRef[]> {
    return (await this.db.execute(sql`
      SELECT lineup_id AS "lineupId", id AS "matchId"
      FROM community_lineup_matches
      WHERE lineup_id = ${lineupId}
        AND status = 'scheduling'
    `)) as unknown as SchedulingMatchRef[];
  }
}

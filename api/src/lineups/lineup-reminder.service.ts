/**
 * Cron-driven reminder service for Community Lineup (ROK-932).
 * Sends vote reminders (24h + 1h before voting deadline) and
 * scheduling reminders (24h + 1h before decided phase end).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { NotificationService } from '../notifications/notification.service';
import { NotificationDedupService } from '../notifications/notification-dedup.service';
import { DEDUP_TTL } from './lineup-notification.constants';

/** Shape of a lineup returned from reminder queries. */
interface ReminderLineup {
  id: number;
  status: string;
  phaseDeadline: Date | null;
  votingDeadline?: Date | null;
}

/** Shape of a non-voter returned from reminder queries. */
interface NonVoter {
  id: number;
  userId: number;
  displayName: string;
  discordId?: string;
}

/** Shape of a scheduling non-voter returned from queries. */
interface SchedulingNonVoter {
  id: number;
  userId: number;
  displayName: string;
  matchId: number;
}

const MS_PER_HOUR = 3600_000;

@Injectable()
export class LineupReminderService {
  private readonly logger = new Logger(LineupReminderService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly notificationService: NotificationService,
    private readonly dedupService: NotificationDedupService,
  ) {}

  /** Check and send vote reminders for active voting lineups. */
  async checkVoteReminders(): Promise<void> {
    const lineups = await this.getVotingLineups();
    for (const lineup of lineups) {
      await this.processVoteReminder(lineup);
    }
  }

  /** Check and send scheduling reminders for active decided lineups. */
  async checkSchedulingReminders(): Promise<void> {
    const lineups = await this.getDecidedLineups();
    for (const lineup of lineups) {
      await this.processSchedulingReminder(lineup);
    }
  }

  // ─── Private: vote reminders ──────────────────────────────

  /** Process vote reminders for a single lineup. */
  private async processVoteReminder(lineup: ReminderLineup): Promise<void> {
    const deadline = lineup.phaseDeadline ?? lineup.votingDeadline;
    if (!deadline) return;

    const hoursLeft = this.hoursUntil(deadline);
    if (hoursLeft > 24 || hoursLeft <= 0) return;

    const window = hoursLeft <= 1 ? '1h' : '24h';
    const nonVoters = await this.getVoteNonVoters(lineup.id);

    for (const voter of nonVoters) {
      await this.sendVoteReminder(lineup.id, voter, window);
    }
  }

  /** Send a single vote reminder DM. */
  private async sendVoteReminder(
    lineupId: number,
    voter: NonVoter,
    window: string,
  ): Promise<void> {
    const key = `lineup-reminder-${window}:${lineupId}:${voter.userId}`;
    if (await this.dedupService.checkAndMarkSent(key, DEDUP_TTL)) return;

    const urgency =
      window === '1h'
        ? 'Last chance to vote -- voting closes in 1 hour'
        : "You haven't voted yet -- voting closes in 24 hours";

    await this.notificationService.create({
      userId: voter.userId,
      type: 'community_lineup',
      title: 'Vote Reminder',
      message: urgency,
      payload: { subtype: 'lineup_vote_reminder', lineupId },
    });
  }

  // ─── Private: scheduling reminders ────────────────────────

  /** Process scheduling reminders for a single lineup. */
  private async processSchedulingReminder(
    lineup: ReminderLineup,
  ): Promise<void> {
    if (!lineup.phaseDeadline) return;

    const hoursLeft = this.hoursUntil(lineup.phaseDeadline);
    if (hoursLeft > 24 || hoursLeft <= 0) return;

    const window = hoursLeft <= 1 ? '1h' : '24h';
    const nonVoters = await this.getSchedulingNonVoters(lineup.id);

    for (const voter of nonVoters) {
      await this.sendSchedulingReminder(voter, window);
    }
  }

  /** Send a single scheduling reminder DM. */
  private async sendSchedulingReminder(
    voter: SchedulingNonVoter,
    window: string,
  ): Promise<void> {
    const key = `lineup-sched-remind:${voter.matchId}:${voter.userId}:${window}`;
    if (await this.dedupService.checkAndMarkSent(key, DEDUP_TTL)) return;

    await this.notificationService.create({
      userId: voter.userId,
      type: 'community_lineup',
      title: 'Scheduling Reminder',
      message: 'Your match is waiting -- pick a time!',
      payload: {
        subtype: 'lineup_scheduling_reminder',
        matchId: voter.matchId,
      },
    });
  }

  // ─── Private: utilities ───────────────────────────────────

  /** Calculate hours remaining until a deadline. */
  private hoursUntil(deadline: Date): number {
    return (deadline.getTime() - Date.now()) / MS_PER_HOUR;
  }

  // ─── Private: DB queries ──────────────────────────────────

  /** Get active lineups in voting status. */
  private async getVotingLineups(): Promise<ReminderLineup[]> {
    return (await this.db.execute(sql`
      SELECT id, status, phase_deadline AS "phaseDeadline",
             phase_deadline AS "votingDeadline"
      FROM community_lineups
      WHERE status = 'voting'
    `)) as unknown as ReminderLineup[];
  }

  /** Get active community lineups in decided status (excludes standalone polls). */
  private async getDecidedLineups(): Promise<ReminderLineup[]> {
    return (await this.db.execute(sql`
      SELECT id, status, phase_deadline AS "phaseDeadline"
      FROM community_lineups
      WHERE status = 'decided'
        AND (phase_duration_override IS NULL OR phase_duration_override->>'standalone' IS NULL)
    `)) as unknown as ReminderLineup[];
  }

  /** Get users who have not yet voted for a lineup. */
  private async getVoteNonVoters(lineupId: number): Promise<NonVoter[]> {
    return (await this.db.execute(sql`
      SELECT u.id, u.id AS "userId",
             COALESCE(u.display_name, u.username) AS "displayName",
             u.discord_id AS "discordId"
      FROM users u
      WHERE u.discord_id IS NOT NULL
        AND u.id NOT IN (
          SELECT user_id FROM community_lineup_votes WHERE lineup_id = ${lineupId}
        )
    `)) as unknown as NonVoter[];
  }

  /** Get match members who have not voted on scheduling slots. */
  private async getSchedulingNonVoters(
    lineupId: number,
  ): Promise<SchedulingNonVoter[]> {
    return (await this.db.execute(sql`
      SELECT u.id, u.id AS "userId",
             COALESCE(u.display_name, u.username) AS "displayName",
             lmm.match_id AS "matchId"
      FROM community_lineup_match_members lmm
      JOIN community_lineup_matches lm ON lm.id = lmm.match_id
      JOIN users u ON u.id = lmm.user_id
      WHERE lm.lineup_id = ${lineupId}
        AND lm.status = 'scheduling'
        AND NOT EXISTS (
          SELECT 1
          FROM community_lineup_schedule_votes csv
          JOIN community_lineup_schedule_slots css
            ON css.id = csv.slot_id
          WHERE css.match_id = lmm.match_id
            AND csv.user_id = lmm.user_id
        )
    `)) as unknown as SchedulingNonVoter[];
  }
}

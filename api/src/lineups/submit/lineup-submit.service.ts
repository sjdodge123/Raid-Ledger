/**
 * Lineup submit service (ROK-1296, U4 SubmitBar).
 *
 * Three explicit submit endpoints (`submit-nominations`, `submit-votes`,
 * `submit-scheduling`) that stamp the corresponding `*_submitted_at`
 * timestamp for the authed user. Re-submission is idempotent and overwrites
 * to `now()`. Each writer triggers `maybeAutoAdvance` so quorum can flip
 * the lineup forward without a follow-up action.
 *
 * Phase mismatch is rejected with 403 — `submit-nominations` only valid in
 * `building`, `submit-votes` only valid in `voting`. The eligibility helper
 * is reused so private-lineup invitee gating stays consistent with vote /
 * nominate.
 */
import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { LineupDetailResponseDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { findLineupById } from '../lineups-query.helpers';
import { assertUserCanParticipate } from '../lineups-eligibility.helpers';
import { maybeAutoAdvance } from '../lineups-auto-advance.helpers';
import { LineupsService } from '../lineups.service';

type Db = PostgresJsDatabase<typeof schema>;
type LineupRow = typeof schema.communityLineups.$inferSelect;

@Injectable()
export class LineupSubmitService {
  private readonly logger = new Logger(LineupSubmitService.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly activityLog: ActivityLogService,
    @Inject(forwardRef(() => LineupsService))
    private readonly lineupsService: LineupsService,
  ) {}

  /** Submit nominations for the authed user (AC2a). */
  async submitNominations(
    lineupId: number,
    userId: number,
    callerRole: string | undefined,
  ): Promise<LineupDetailResponseDto> {
    const lineup = await this.loadAndGateLineup(
      lineupId,
      userId,
      callerRole,
      'building',
    );
    await upsertSubmission(this.db, lineup.id, userId, 'nominations');
    await this.activityLog.log(
      'lineup',
      lineup.id,
      'submit_nominations',
      userId,
    );
    await this.runAutoAdvance(lineup.id);
    return this.lineupsService.findById(lineup.id, userId);
  }

  /** Submit votes for the authed user (AC2b). */
  async submitVotes(
    lineupId: number,
    userId: number,
    callerRole: string | undefined,
  ): Promise<LineupDetailResponseDto> {
    const lineup = await this.loadAndGateLineup(
      lineupId,
      userId,
      callerRole,
      'voting',
    );
    await upsertSubmission(this.db, lineup.id, userId, 'votes');
    await this.activityLog.log('lineup', lineup.id, 'submit_votes', userId);
    await this.runAutoAdvance(lineup.id);
    return this.lineupsService.findById(lineup.id, userId);
  }

  /** Submit scheduling for a specific match-member row (AC2c). */
  async submitScheduling(
    lineupId: number,
    matchId: number,
    userId: number,
    callerRole: string | undefined,
  ): Promise<LineupDetailResponseDto> {
    const [lineup] = await findLineupById(this.db, lineupId);
    if (!lineup) throw new NotFoundException('Lineup not found');
    await assertUserCanParticipate(this.db, lineup, {
      id: userId,
      role: callerRole,
    });
    await this.stampMatchMember(lineup.id, matchId, userId);
    await this.activityLog.log(
      'lineup',
      lineup.id,
      'submit_scheduling',
      userId,
      { matchId },
    );
    return this.lineupsService.findById(lineup.id, userId);
  }

  /** Resolve the lineup and gate by status + eligibility. */
  private async loadAndGateLineup(
    lineupId: number,
    userId: number,
    callerRole: string | undefined,
    requiredStatus: LineupRow['status'],
  ): Promise<LineupRow> {
    const [lineup] = await findLineupById(this.db, lineupId);
    if (!lineup) throw new NotFoundException('Lineup not found');
    if (lineup.status !== requiredStatus) {
      throw new ForbiddenException(
        `Submit not allowed in ${lineup.status} phase`,
      );
    }
    await assertUserCanParticipate(this.db, lineup, {
      id: userId,
      role: callerRole,
    });
    return lineup;
  }

  /**
   * Stamp the match-member row. 403 when the user is not a member of the
   * match OR when the match doesn't belong to this lineup. ROK-1296 Codex
   * P1: without the lineup-id verification, a participant in lineup A who
   * shares a match-member row in lineup B could stamp B via lineup A's
   * URL — write succeeds but activity-log credits the wrong lineup.
   */
  private async stampMatchMember(
    lineupId: number,
    matchId: number,
    userId: number,
  ): Promise<void> {
    const [match] = await this.db
      .select({ id: schema.communityLineupMatches.id })
      .from(schema.communityLineupMatches)
      .where(
        and(
          eq(schema.communityLineupMatches.id, matchId),
          eq(schema.communityLineupMatches.lineupId, lineupId),
        ),
      )
      .limit(1);
    if (!match) {
      throw new ForbiddenException('Match does not belong to this lineup');
    }
    const result = await this.db
      .update(schema.communityLineupMatchMembers)
      .set({ schedulingSubmittedAt: sql`now()` })
      .where(
        and(
          eq(schema.communityLineupMatchMembers.matchId, matchId),
          eq(schema.communityLineupMatchMembers.userId, userId),
        ),
      )
      .returning({ id: schema.communityLineupMatchMembers.id });
    if (result.length === 0) {
      throw new ForbiddenException('Not a member of this match');
    }
  }

  /** Fire auto-advance with the service-owned deps, swallowing errors. */
  private async runAutoAdvance(lineupId: number): Promise<void> {
    try {
      await maybeAutoAdvance(this.lineupsService.autoAdvanceDeps(), lineupId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `maybeAutoAdvance failed after submit on lineup ${lineupId}: ${msg}`,
      );
    }
  }
}

/** Upsert the per-user submission row, stamping the requested phase column. */
async function upsertSubmission(
  db: Db,
  lineupId: number,
  userId: number,
  phase: 'nominations' | 'votes',
): Promise<void> {
  const column =
    phase === 'nominations' ? 'nominations_submitted_at' : 'votes_submitted_at';
  await db.execute(sql`
    INSERT INTO community_lineup_user_submissions
      (lineup_id, user_id, ${sql.raw(column)}, created_at, updated_at)
    VALUES (${lineupId}, ${userId}, now(), now(), now())
    ON CONFLICT (lineup_id, user_id) DO UPDATE
       SET ${sql.raw(column)} = now(),
           updated_at = now()
  `);
}

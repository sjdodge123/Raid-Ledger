/**
 * Lineup submit service (ROK-1296, U4 SubmitBar).
 *
 * One explicit submit endpoint (`submit-votes`) that stamps
 * `votes_submitted_at` for the authed user. `submit-nominations` is retired
 * by TDB:449 — building quorum no longer reads `nominations_submitted_at`.
 * `submit-scheduling` is retired by ROK-1544 — the scheduling
 * surface has no member Submit step; `scheduling_submitted_at` is stamped
 * server-side from the vote (`scheduling/scheduling-submitted-at.helpers.ts`). Re-submission is idempotent and overwrites
 * to `now()`. The writer triggers `maybeAutoAdvance` so quorum can flip
 * the lineup forward without a follow-up action.
 *
 * Phase mismatch is rejected with 403 — `submit-votes` is only valid in
 * `voting`. The eligibility helper is reused so private-lineup invitee
 * gating stays consistent with vote / nominate.
 */
import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
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
    await upsertVoteSubmission(this.db, lineup.id, userId);
    await this.activityLog.log('lineup', lineup.id, 'submit_votes', userId);
    await this.runAutoAdvance(lineup.id);
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

/** Upsert the per-user submission row, stamping `votes_submitted_at`. */
async function upsertVoteSubmission(
  db: Db,
  lineupId: number,
  userId: number,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO community_lineup_user_submissions
      (lineup_id, user_id, votes_submitted_at, created_at, updated_at)
    VALUES (${lineupId}, ${userId}, now(), now(), now())
    ON CONFLICT (lineup_id, user_id) DO UPDATE
       SET votes_submitted_at = now(),
           updated_at = now()
  `);
}

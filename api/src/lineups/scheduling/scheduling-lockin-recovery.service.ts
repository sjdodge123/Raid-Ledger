/**
 * Lock-in claim recovery (ROK-2033).
 *
 * A lock-in claims the poll (`scheduled`, stamp set) before it creates the
 * event and links it. A request that dies in between leaves the poll stuck:
 * every door refuses it and no event exists. Two ways out:
 *
 * - **Cron** — every 5 minutes, release every claim older than
 *   `LOCK_IN_CLAIM_STALE_MS` back to `scheduling` and delete the events it
 *   orphaned. One failing match is logged and counted; the rest still run.
 * - **Admin** — `reopenByAdmin` recovers one match's claim of ANY age (the
 *   admin route). The release is token-fenced, so a request still in flight
 *   that links first wins and the admin gets a 409.
 *
 * Reschedule claims (ROK-2040) are never stamped, so the shared predicate
 * (`lock_in_claimed_at IS NOT NULL AND linked_event_id IS NULL`) never selects
 * them. Core scheduling infrastructure, not a hub behaviour: it lives outside
 * `api/src/plugins/` like the other scheduling crons.
 */
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ReopenLockInResponseDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { EventsService } from '../../events/events.service';
import { SchedulingPollEmbedService } from './scheduling-poll-embed.service';
import {
  findRecoverableClaim,
  findStaleClaims,
  recoverClaim,
  type LockInRecoveryDeps,
  type PendingLockInClaim,
} from './scheduling-lockin-recovery.helpers';

/** SchedulerRegistry name; must match the `CORE_JOB_METADATA` key. */
const JOB_NAME = 'SchedulingLockInRecoveryService_runSweep';

/** 409 copy when there is nothing (any more) to reopen. */
export const NOTHING_TO_REOPEN_MESSAGE =
  'This poll has no unfinished lock-in to reopen';

@Injectable()
export class SchedulingLockInRecoveryService {
  private readonly logger = new Logger(SchedulingLockInRecoveryService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly cronJobService: CronJobService,
    private readonly eventsService: EventsService,
    private readonly pollEmbed: SchedulingPollEmbedService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: JOB_NAME })
  async handleCron(): Promise<void> {
    await this.cronJobService.executeWithTracking(JOB_NAME, () =>
      this.runSweep(),
    );
  }

  /**
   * Recover every stale claim, isolating each match.
   *
   * @returns `false` on an idle tick (no stale claim) so no execution row is
   *   recorded; `{ degraded: true }` when any match threw.
   */
  async runSweep(
    now: Date = new Date(),
  ): Promise<void | false | { degraded: true }> {
    const claims = await findStaleClaims(this.db, now);
    if (claims.length === 0) return false;
    let recovered = 0;
    let failed = 0;
    for (const claim of claims) {
      try {
        if (await this.recoverOne(claim)) recovered++;
      } catch (err: unknown) {
        failed++;
        this.logger.error(
          `Lock-in recovery failed for match ${claim.matchId}: ${errMsg(err)}`,
        );
      }
    }
    this.logger.log(
      `Lock-in recovery sweep: ${recovered}/${claims.length} claim(s) recovered` +
        (failed > 0 ? `, ${failed} failure(s)` : ''),
    );
    if (failed > 0) return { degraded: true };
  }

  /**
   * Admin bypass of the staleness threshold: recover this match's unlinked
   * claim of any age. 404 when the match is missing, 409 when there is no
   * claim or the in-flight request linked/released first.
   */
  async reopenByAdmin(
    matchId: number,
    adminId: number,
  ): Promise<ReopenLockInResponseDto> {
    await this.assertMatchExists(matchId);
    const claim = await findRecoverableClaim(this.db, matchId);
    if (!claim) throw new ConflictException(NOTHING_TO_REOPEN_MESSAGE);
    const result = await recoverClaim(this.deps(), claim, {
      kind: 'admin',
      userId: adminId,
    });
    if (!result.recovered) {
      throw new ConflictException(NOTHING_TO_REOPEN_MESSAGE);
    }
    return {
      matchId,
      status: 'scheduling',
      discardedEventIds: result.discardedEventIds,
    };
  }

  private async recoverOne(claim: PendingLockInClaim): Promise<boolean> {
    const result = await recoverClaim(this.deps(), claim, { kind: 'cron' });
    return result.recovered;
  }

  private async assertMatchExists(matchId: number): Promise<void> {
    const m = schema.communityLineupMatches;
    const [row] = await this.db
      .select({ id: m.id })
      .from(m)
      .where(eq(m.id, matchId))
      .limit(1);
    if (!row) throw new NotFoundException('Match not found');
  }

  private deps(): LockInRecoveryDeps {
    return {
      db: this.db,
      eventsService: this.eventsService,
      pollEmbed: this.pollEmbed,
      logger: this.logger,
    };
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

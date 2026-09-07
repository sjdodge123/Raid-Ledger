/**
 * BullMQ producer for lineup phase transitions (ROK-946).
 * Follows the embed-sync.queue.ts pattern.
 *
 * ROK-1512 — failure contract of `scheduleTransition`: a failed enqueue is
 * captured to Sentry (`context: lineup-phase-schedule`) AND rethrown. It used
 * to be swallowed into `logger.error`, which hid a BullMQ job-id rejection for
 * two ROK-1443 gate rounds (the deadline job silently ceased to exist).
 *
 * Call-site audit (`grep -rn scheduleTransition api/src`). Every caller
 * schedules AFTER its row has committed, and boot rehydration re-derives the
 * job from the row, so each opts into best-effort explicitly via
 * `scheduleTransitionBestEffort` (lineup-phase-schedule.helpers.ts):
 *   - `lineups-actions.helpers::createLineup` — best-effort: the lineup row
 *     exists; a 500 here would make the client re-create it.
 *   - `lineups-lifecycle.helpers::applyStatusUpdate` — best-effort: the status
 *     UPDATE committed; a throw would skip the phase notifications that follow
 *     and, from inside a phase job, fail a job whose retry is a status no-op.
 *   - `standalone-poll.service::scheduleArchive` — best-effort: poll row
 *     committed; `reconcileArchiveJobs` heals it at boot.
 *   - `lineup-phase.processor::rehydrateOneLineup` and `reconcileArchiveJobs`
 *     below — best-effort PER ITEM so one bad lineup cannot abort the boot
 *     loop for the rest.
 * New callers get the throwing contract by default; opt out deliberately.
 * `scheduleGraceAdvance` keeps its own swallow (out of ROK-1512 scope).
 */
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as Sentry from '@sentry/nestjs';
import { bestEffortInit } from '../../common/lifecycle.util';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { parseTimestampUtc } from '../../drizzle/timestamp-utils';
import * as schema from '../../drizzle/schema';
import {
  LINEUP_GRACE_ADVANCE,
  LINEUP_PHASE_QUEUE,
  LINEUP_PHASE_RESCHEDULED_SUFFIX,
  LINEUP_PHASE_TRANSITION,
  type LineupGraceAdvanceJobData,
  type LineupPhaseJobData,
} from './lineup-phase.constants';
import { scheduleTransitionBestEffort } from './lineup-phase-schedule.helpers';

interface ActiveStandaloneArchiveCandidate {
  lineupId: number;
  phaseDeadline: Date | string;
}

@Injectable()
export class LineupPhaseQueueService implements OnModuleInit {
  private readonly logger = new Logger(LineupPhaseQueueService.name);

  constructor(
    @InjectQueue(LINEUP_PHASE_QUEUE) private readonly queue: Queue,
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Re-queue missing archive transitions for active standalone polls
   * (ROK-1192). Runs at boot so a deploy that drops the BullMQ queue
   * doesn't leave decided-state polls without a deadline job.
   */
  async onModuleInit(): Promise<void> {
    await bestEffortInit('LineupPhaseQueueService', this.logger, () =>
      this.reconcileArchiveJobs(),
    );
  }

  /**
   * Idempotent: re-schedule the `decided → archived` transition for
   * every active standalone poll whose `phase_deadline` is still in
   * the future. Safe to call repeatedly — `scheduleTransition`
   * removes the existing delayed job before re-adding it.
   */
  async reconcileArchiveJobs(): Promise<void> {
    const candidates = await this.findStandaloneArchiveCandidates();
    if (candidates.length === 0) return;
    this.logger.log(
      `Reconciling ${candidates.length} standalone archive job(s)`,
    );
    for (const { lineupId, phaseDeadline } of candidates) {
      const deadline = parseTimestampUtc(phaseDeadline);
      const delayMs = deadline.getTime() - Date.now();
      if (delayMs <= 0) continue;
      // ROK-1512: per-item best-effort so one bad lineup cannot abort the
      // rest of the boot reconciliation (Sentry already has the failure).
      await scheduleTransitionBestEffort(
        this,
        lineupId,
        'archived',
        delayMs,
        'reconcileArchiveJobs',
      );
    }
  }

  /** Decided standalone lineups with a future deadline. */
  private async findStandaloneArchiveCandidates(): Promise<
    ActiveStandaloneArchiveCandidate[]
  > {
    return (await this.db.execute(sql`
      SELECT id AS "lineupId",
             phase_deadline AS "phaseDeadline"
      FROM community_lineups
      WHERE status = 'decided'
        AND phase_duration_override->>'standalone' = 'true'
        AND phase_deadline IS NOT NULL
        AND phase_deadline > NOW()
    `)) as unknown as ActiveStandaloneArchiveCandidate[];
  }

  /** Schedule a phase transition after the given delay. */
  async scheduleTransition(
    lineupId: number,
    targetStatus: string,
    delayMs: number,
  ): Promise<void> {
    const baseId = `lineup-phase-${lineupId}-${targetStatus}`;
    try {
      const jobId = await this.freeTransitionJobId(baseId);
      await this.enqueue(
        jobId,
        LINEUP_PHASE_TRANSITION,
        { lineupId, targetStatus } satisfies LineupPhaseJobData,
        delayMs,
      );
      this.logger.debug(
        `Scheduled ${targetStatus} for lineup ${lineupId} in ${Math.round(delayMs / 60_000)}m`,
      );
    } catch (error) {
      // ROK-1512: a lost deadline job is a silently stuck lineup. Report it
      // and rethrow — callers that must keep going wrap explicitly via
      // `scheduleTransitionBestEffort` (see file header for the audit).
      Sentry.captureException(error, {
        tags: { context: 'lineup-phase-schedule', lineupId, targetStatus },
      });
      this.logger.error(
        `Failed to schedule ${targetStatus} for lineup ${lineupId}: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
      throw error;
    }
  }

  /**
   * ROK-1253: Schedule a delayed grace re-evaluation. After `delayMs` the
   * processor's grace branch loads the lineup, re-runs the quorum check and
   * either advances or clears `pending_advance_at`. Distinct job name and
   * jobId namespace from `phase-transition` so a stale-status no-op never
   * fires unintentionally.
   */
  async scheduleGraceAdvance(lineupId: number, delayMs: number): Promise<void> {
    const jobId = `lineup-grace-${lineupId}`;
    try {
      await this.removeExisting(jobId);
      await this.enqueue(
        jobId,
        LINEUP_GRACE_ADVANCE,
        { lineupId } satisfies LineupGraceAdvanceJobData,
        delayMs,
      );
      this.logger.debug(
        `Scheduled grace-advance for lineup ${lineupId} in ${delayMs}ms`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to schedule grace-advance for lineup ${lineupId}: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
    }
  }

  /**
   * ROK-1253: Remove a pending grace-advance job. Idempotent; safe to call
   * when no job exists. Called by `applyStatusUpdate` on any operator-driven
   * transition so the row's new state (forward or backward) is authoritative.
   */
  async cancelGraceAdvance(lineupId: number): Promise<void> {
    const jobId = `lineup-grace-${lineupId}`;
    try {
      await this.removeExisting(jobId);
    } catch (error) {
      this.logger.debug(
        `cancelGraceAdvance(${lineupId}) ignored: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
    }
  }

  /**
   * Cancel all pending phase-transition jobs for a lineup.
   * Removes delayed/waiting jobs for all four target statuses AND the
   * ROK-1253 grace job. Used by smoke tests to prevent stale jobs from
   * advancing lineups.
   */
  async cancelAllForLineup(lineupId: number): Promise<number> {
    const targets = ['voting', 'decided', 'scheduling', 'archived'];
    let removed = 0;
    for (const target of targets) {
      const jobId = `lineup-phase-${lineupId}-${target}`;
      removed += (await this.removeIfPending(jobId)) ? 1 : 0;
      // ROK-1443: and its re-scheduled twin (see `freeTransitionJobId`).
      const altId = `${jobId}${LINEUP_PHASE_RESCHEDULED_SUFFIX}`;
      removed += (await this.removeIfPending(altId)) ? 1 : 0;
    }
    // ROK-1253: also drop any pending grace-advance job.
    removed += (await this.removeIfPending(`lineup-grace-${lineupId}`)) ? 1 : 0;
    if (removed > 0) {
      this.logger.debug(
        `Cancelled ${removed} phase job(s) for lineup ${lineupId}`,
      );
    }
    return removed;
  }

  /**
   * ROK-1443: the id a fresh transition job can actually occupy. A job that
   * is still ACTIVE under the base id cannot be removed (locked by its
   * worker) and `queue.add` with its id is BullMQ's duplicate branch — the
   * existing job is returned and nothing is stored, silently. That is the
   * shape of the building-deadline extension, which re-schedules `voting`
   * from inside the very `voting` job it runs in; without this the extended
   * window never fired. Pending jobs under BOTH ids are cleared first, so
   * the pair never holds two runnable transitions for one target.
   */
  private async freeTransitionJobId(baseId: string): Promise<string> {
    const altId = `${baseId}${LINEUP_PHASE_RESCHEDULED_SUFFIX}`;
    const baseOccupied = await this.removeExisting(baseId);
    await this.removeExisting(altId);
    return baseOccupied ? altId : baseId;
  }

  /**
   * Remove a delayed/waiting job by ID. Returns `true` when the id is still
   * occupied afterwards — an active (locked) or retained failed job that a
   * same-id `add` would silently collapse into.
   */
  private async removeExisting(jobId: string): Promise<boolean> {
    const existing = await this.queue.getJob(jobId);
    if (!existing) return false;
    const state = await existing.getState();
    if (state === 'delayed' || state === 'waiting') {
      await existing.remove();
      return false;
    }
    return true;
  }

  /** Remove a delayed/waiting job and report whether anything was removed. */
  private async removeIfPending(jobId: string): Promise<boolean> {
    const job = await this.queue.getJob(jobId);
    if (!job) return false;
    const state = await job.getState();
    if (state === 'delayed' || state === 'waiting') {
      await job.remove();
      return true;
    }
    return false;
  }

  /** Shared add-with-options used by both phase and grace job scheduling. */
  private async enqueue(
    jobId: string,
    jobName: string,
    payload: LineupPhaseJobData | LineupGraceAdvanceJobData,
    delayMs: number,
  ): Promise<void> {
    await this.queue.add(jobName, payload, {
      jobId,
      delay: Math.max(0, delayMs),
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: true,
      removeOnFail: 50,
    });
  }
}

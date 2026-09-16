/**
 * Scheduling-poll expiry warning + expired re-render (ROK-1604).
 *
 * Every 5 minutes:
 * 1. **Warn** — DM the lineup creator ONCE when an unlocked poll with a voted
 *    future slot is within `POLL_EXPIRY_WARN_HOURS` of `phase_deadline`. The
 *    DM's Link button opens the poll page with `?lock=<slotId>`, which shows
 *    the lock-in confirm (never a direct commit).
 * 2. **Re-render** — once a deadline passes on an unlocked poll with a posted
 *    card, fire one embed update so the card shows the expired state. Nothing
 *    else re-renders at expiry (the lineup-phase job archives silently).
 *
 * Idempotency is the DB-backed dedup table with PERMANENT keys (no
 * migration): `sched-poll-expiry-warn:{matchId}` and
 * `sched-poll-expired-embed:{matchId}`. One warning per poll even if the
 * deadline later moves; the dedup INSERT arbitrates concurrent instances.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { NotificationService } from '../../notifications/notification.service';
import { NotificationDedupService } from '../../notifications/notification-dedup.service';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { SettingsService } from '../../settings/settings.service';
import { POLL_EXPIRY_WARN_HOURS } from '../lineup-notification.constants';
import { SchedulingPollEmbedService } from './scheduling-poll-embed.service';
import {
  buildExpiryWarnCopy,
  findExpiredEmbedMatchIds,
  findExpiryWarnCandidates,
  findLeadingFutureSlot,
  isInWarnWindow,
  type ExpiryWarnCandidate,
  type LeadingSlot,
} from './scheduling-poll-expiry.helpers';

const JOB_NAME = 'SchedulingPollExpiryService_runSweep';

/** Per-phase tally: work done vs polls that threw. */
interface PhaseTally {
  done: number;
  failed: number;
}

@Injectable()
export class SchedulingPollExpiryService {
  private readonly logger = new Logger(SchedulingPollExpiryService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly notificationService: NotificationService,
    private readonly dedupService: NotificationDedupService,
    private readonly cronJobService: CronJobService,
    private readonly pollEmbed: SchedulingPollEmbedService,
    private readonly settingsService: SettingsService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: JOB_NAME })
  async handleCron(): Promise<void> {
    await this.cronJobService.executeWithTracking(JOB_NAME, () =>
      this.runSweep(),
    );
  }

  /**
   * Warn creators, then re-render newly-expired cards.
   *
   * @returns `false` on a genuinely idle tick (nothing done, nothing failed)
   *   so no execution row is recorded; `{ degraded: true }` when any poll or
   *   phase threw (ROK-1197 marker).
   */
  async runSweep(): Promise<void | false | { degraded: true }> {
    const warn = await this.runPhase('warn', () => this.warnCreators());
    const expired = await this.runPhase('rerender', () =>
      this.rerenderExpired(),
    );
    const done = warn.done + expired.done;
    const failed = warn.failed + expired.failed;
    if (done === 0 && failed === 0) return false;
    this.logger.log(
      `Poll expiry sweep: ${warn.done} warning(s), ${expired.done} re-render(s)` +
        (failed > 0 ? `, ${failed} failure(s)` : ''),
    );
    if (failed > 0) return { degraded: true };
  }

  /** Run one phase so a query failure in it cannot starve the other. */
  private async runPhase(
    name: string,
    phase: () => Promise<PhaseTally>,
  ): Promise<PhaseTally> {
    try {
      return await phase();
    } catch (err) {
      this.logger.warn(`Poll expiry ${name} phase failed: ${errMsg(err)}`);
      return { done: 0, failed: 1 };
    }
  }

  /** Warn every eligible creator; per-poll failures are isolated. */
  private async warnCreators(): Promise<PhaseTally> {
    const candidates = await findExpiryWarnCandidates(this.db);
    const tally: PhaseTally = { done: 0, failed: 0 };
    if (candidates.length === 0) return tally;
    const timeZone = (await this.settingsService.getDefaultTimezone()) ?? 'UTC';
    for (const poll of candidates) {
      try {
        if (await this.warnOne(poll, timeZone)) tally.done++;
      } catch (err) {
        tally.failed++;
        this.logger.warn(
          `Expiry warning failed for match ${poll.matchId}: ${errMsg(err)}`,
        );
      }
    }
    return tally;
  }

  /**
   * Send one creator warning unless already sent.
   *
   * The leading slot is resolved BEFORE the key is marked, so a poll with no
   * voted future slot neither sends nor churns a mark/release pair each tick
   * (and a later vote can still earn the warning).
   *
   * @returns True when a notification was created
   */
  private async warnOne(
    poll: ExpiryWarnCandidate,
    timeZone: string,
  ): Promise<boolean> {
    if (!isInWarnWindow(poll.phaseDeadline, new Date(), POLL_EXPIRY_WARN_HOURS))
      return false;
    const leader = await findLeadingFutureSlot(this.db, poll.matchId);
    if (!leader) return false;
    const key = `sched-poll-expiry-warn:${poll.matchId}`;
    if (await this.dedupService.checkAndMarkSent(key, null)) return false;
    try {
      await this.sendWarning(poll, leader, timeZone);
    } catch (err) {
      // Give the claim back so the next tick retries instead of going silent.
      await this.dedupService.releaseKey(key);
      throw err;
    }
    return true;
  }

  /** Create the creator's warning notification (dispatches the DM). */
  private async sendWarning(
    poll: ExpiryWarnCandidate,
    leader: LeadingSlot,
    timeZone: string,
  ): Promise<void> {
    const copy = buildExpiryWarnCopy(
      poll.gameName,
      poll.phaseDeadline,
      leader.proposedTime,
      timeZone,
    );
    await this.notificationService.create({
      userId: poll.creatorId,
      type: 'community_lineup',
      title: copy.title,
      message: copy.message,
      payload: {
        // Own rate-limit bucket + per-poll window (nudge service rationale).
        subtype: 'scheduling_poll_expiry_warning',
        reminderWindow: `expiry-${poll.matchId}`,
        lineupId: poll.lineupId,
        matchId: poll.matchId,
        slotId: leader.slotId,
        lockLabel: copy.lockLabel,
      },
    });
  }

  /** Fire one embed update per newly-expired poll card. */
  private async rerenderExpired(): Promise<PhaseTally> {
    const matchIds = await findExpiredEmbedMatchIds(this.db);
    const tally: PhaseTally = { done: 0, failed: 0 };
    for (const matchId of matchIds) {
      try {
        const key = `sched-poll-expired-embed:${matchId}`;
        if (await this.dedupService.checkAndMarkSent(key, null)) continue;
        this.pollEmbed.fireUpdateEmbed(matchId);
        tally.done++;
      } catch (err) {
        tally.failed++;
        this.logger.warn(
          `Expired re-render failed for match ${matchId}: ${errMsg(err)}`,
        );
      }
    }
    return tally;
  }
}

/** Narrow an unknown throw to a log-safe message. */
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

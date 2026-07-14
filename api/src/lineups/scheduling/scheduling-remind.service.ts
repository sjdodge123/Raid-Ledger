/**
 * Manual "remind voters" nudge for scheduling polls (ROK-1395).
 *
 * Separate injectable (not more SchedulingService methods) to respect the
 * 300-line file cap. Reuses the cron reminder machinery end to end: audience
 * via `resolveLineupReminderTargets` (members minus schedule-voters,
 * public/private aware), dispatch via `sendManualSchedulingReminder` (same
 * payload subtype → unchanged click-through), and race-safe anti-spam via
 * `NotificationDedupService.checkAndMarkSent`.
 */
import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { RemindVotersResponseDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { NotificationService } from '../../notifications/notification.service';
import { NotificationDedupService } from '../../notifications/notification-dedup.service';
import { resolveLineupReminderTargets } from '../lineup-reminder-target.helpers';
import { sendManualSchedulingReminder } from '../lineup-reminder-dispatch.helpers';
import { MANUAL_REMIND_COOLDOWN_TTL } from '../lineup-notification.constants';
import { findMatchById } from '../lineups-match-query.helpers';
import { findLineupPollMeta } from './scheduling-query.helpers';
import {
  assertSchedulingEnabled,
  assertSchedulable,
} from './scheduling-guard.helpers';

interface Caller {
  id: number;
  role?: string;
}

@Injectable()
export class SchedulingRemindService {
  private readonly logger = new Logger(SchedulingRemindService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly notificationService: NotificationService,
    private readonly dedupService: NotificationDedupService,
  ) {}

  /**
   * Send a one-shot nudge to poll members who haven't voted yet.
   * Creator/admin/operator only; 1h per-match cooldown (429 when armed);
   * 24h per-recipient dedup. Returns counts for the toolbar toast.
   */
  async remindVoters(
    lineupId: number,
    matchId: number,
    caller: Caller,
  ): Promise<RemindVotersResponseDto> {
    const [match] = await findMatchById(this.db, matchId);
    if (!match) throw new NotFoundException('Match not found');
    // ROK-1306: a matchId from another lineup must not act under this URL.
    if (match.lineupId !== lineupId) {
      throw new NotFoundException('Match not found in this lineup');
    }
    assertSchedulingEnabled(match);
    assertSchedulable(match);
    await this.assertCallerMayRemind(lineupId, caller);
    await this.assertNotOnCooldown(matchId);

    const targets = await resolveLineupReminderTargets(
      this.db,
      lineupId,
      'schedule',
      matchId,
    );
    let reminded = 0;
    let skipped = 0;
    for (const userId of targets) {
      // Never self-nudge the actor (mirrors cancelPoll's except-the-actor).
      if (userId === caller.id) continue;
      // Per-recipient isolation (mirrors the tiebreaker cron loop): one
      // failed create must not 500 the whole fan-out after earlier sends
      // already went out — count it as skipped and keep going.
      try {
        const sent = await sendManualSchedulingReminder(
          {
            notificationService: this.notificationService,
            dedupService: this.dedupService,
          },
          lineupId,
          matchId,
          userId,
        );
        if (sent) reminded++;
        else skipped++;
      } catch (err) {
        skipped++;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Manual remind failed for match ${matchId} user ${userId}: ${msg}`,
        );
      }
    }
    return { reminded, skipped };
  }

  /** Lineup creator OR admin/operator; anyone else is 403. */
  private async assertCallerMayRemind(
    lineupId: number,
    caller: Caller,
  ): Promise<void> {
    if (caller.role === 'admin' || caller.role === 'operator') return;
    const [lineup] = await findLineupPollMeta(this.db, lineupId);
    if (!lineup) throw new NotFoundException('Lineup not found');
    if (lineup.createdBy !== caller.id) {
      throw new ForbiddenException(
        'Only the poll creator or an operator can remind voters',
      );
    }
  }

  /**
   * Arm the per-match cooldown BEFORE resolving targets or dispatching:
   * `checkAndMarkSent` is atomic (Redis + ON CONFLICT), so two concurrent
   * clicks can't both pass this gate. The per-recipient 24h dedup inside the
   * dispatch helper is the second, independent double-send guard.
   */
  private async assertNotOnCooldown(matchId: number): Promise<void> {
    const key = `lineup-sched-manual-remind-cooldown:${matchId}`;
    const onCooldown = await this.dedupService.checkAndMarkSent(
      key,
      MANUAL_REMIND_COOLDOWN_TTL,
    );
    if (onCooldown) {
      throw new HttpException(
        'Voters were reminded recently -- try again later',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}

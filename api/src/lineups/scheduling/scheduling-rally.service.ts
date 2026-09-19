/**
 * Organiser "Rally the non-responders" nudge for scheduling polls (ROK-1618).
 *
 * A separate injectable (not more `SchedulingService` methods) to respect the
 * 300-line file cap, and deliberately NOT part of `SchedulingRemindService`:
 * the two actions differ in audience resolver and in cooldown length.
 *
 * Reuses, end to end, machinery that already ships:
 *   - audience  -> `findPendingMemberIds(db, matchId, false)` (D1), the very
 *     query the recurring 24h cron nudge uses, so the member-age and
 *     deactivation guards come free and a `no` stance already excludes;
 *   - dispatch  -> `sendPollNudge` (D2), which marks the *shared* 24h
 *     per-member key, so a rally can never out-spam the automated nudge;
 *   - cooldown  -> `NotificationDedupService.checkAndMarkSent` (D3/D7), the
 *     same atomic mechanism `SchedulingRemindService` uses for its 1h gate.
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
import type { RallyNonVotersResponseDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { NotificationService } from '../../notifications/notification.service';
import { NotificationDedupService } from '../../notifications/notification-dedup.service';
import { POLL_RALLY_COOLDOWN_SECONDS } from '../lineup-notification.constants';
import { findMatchById } from '../lineups-match-query.helpers';
import { findLineupPollMeta } from './scheduling-query.helpers';
import {
  assertSchedulingEnabled,
  assertPollOpen,
} from './scheduling-guard.helpers';
import { isPollOrganiser } from './scheduling-lock-in.helpers';
import { rallyCooldownKey } from './scheduling-rally.helpers';
import {
  findPendingMemberIds,
  loadNudgePollById,
  pollNudgeKey,
  sendPollNudge,
  type NudgePoll,
} from './scheduling-poll-nudge.helpers';

interface Caller {
  id: number;
  role?: string;
}

@Injectable()
export class SchedulingRallyService {
  private readonly logger = new Logger(SchedulingRallyService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly notificationService: NotificationService,
    private readonly dedupService: NotificationDedupService,
  ) {}

  /**
   * DM every poll member who still owes a vote on a still-future slot.
   *
   * Organiser-only (creator, admin or operator); 6h per-poll cooldown (429
   * when armed); 24h per-member dedup shared with the recurring cron nudge.
   *
   * @param lineupId - Lineup from the URL, cross-checked against the match.
   * @param matchId - The scheduling poll being rallied.
   * @param caller - The authenticated caller and their role.
   * @returns Counts for the organiser's toast; `pending === nudged + skipped`.
   */
  async rallyNonVoters(
    lineupId: number,
    matchId: number,
    caller: Caller,
  ): Promise<RallyNonVotersResponseDto> {
    await this.loadAndGuard(lineupId, matchId, caller);
    // D7: arm BEFORE any audience work, so two concurrent presses cannot
    // both fan out. `checkAndMarkSent` is atomic (Redis + ON CONFLICT).
    const cooldownUntil = await this.armCooldown(matchId);
    const { poll, userIds } = await this.resolveAudience(matchId, caller);
    if (userIds.length === 0) return this.refundCooldown(matchId);

    const { nudged, skipped } = await this.dispatch(poll, userIds);
    return { pending: userIds.length, nudged, skipped, cooldownUntil };
  }

  /**
   * Load the poll and resolve who still owes a vote, AFTER the cooldown is
   * armed (D7 — two concurrent presses must not both fan out).
   *
   * `assertPollOpen` is a looser predicate than the nudgeable-polls SQL (a
   * `voting` lineup with a `suggested` match passes the guard but matches no
   * row), and this step can also fail on the database. Either way nobody was
   * DM'd, so the just-claimed 6h key is given back rather than locking the
   * organiser out for nothing. Precedent: `SchedulingPollExpiryService.warnOne`.
   *
   * @param matchId - The poll being rallied.
   * @param caller - The authenticated caller, removed from the audience.
   * @returns The nudgeable poll and the members a DM could reach.
   * @throws The original error, with the cooldown released.
   */
  private async resolveAudience(
    matchId: number,
    caller: Caller,
  ): Promise<{ poll: NudgePoll; userIds: number[] }> {
    try {
      const poll = await loadNudgePollById(this.db, matchId);
      // The poll stopped being nudgeable between the guard and here.
      if (!poll) throw new NotFoundException('Match not found');
      // The actor is filtered out of the AUDIENCE, not merely skipped during
      // dispatch, so `pending` counts only members a DM could reach and the
      // `pending === nudged + skipped` invariant holds.
      const userIds = (
        await findPendingMemberIds(this.db, matchId, false)
      ).filter((userId) => userId !== caller.id);
      return { poll, userIds };
    } catch (err) {
      await this.releaseQuietly(rallyCooldownKey(matchId));
      throw err;
    }
  }

  /**
   * Hand a dedup key back, never letting the release itself become the error
   * the caller sees — the original failure is always the interesting one.
   *
   * @param key - Dedup key to release.
   */
  private async releaseQuietly(key: string): Promise<void> {
    try {
      await this.dedupService.releaseKey(key);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to release dedup key ${key}: ${msg}`);
    }
  }

  /**
   * Every state + permission gate, in the order the 404s must fire (§3.5).
   *
   * @throws NotFoundException / BadRequestException / ForbiddenException
   */
  private async loadAndGuard(
    lineupId: number,
    matchId: number,
    caller: Caller,
  ): Promise<void> {
    const [match] = await findMatchById(this.db, matchId);
    if (!match) throw new NotFoundException('Match not found');
    // ROK-1306: a matchId from another lineup must not act under this URL.
    if (match.lineupId !== lineupId) {
      throw new NotFoundException('Match not found in this lineup');
    }
    assertSchedulingEnabled(match);
    const [lineup] = await findLineupPollMeta(this.db, lineupId);
    if (!lineup) throw new NotFoundException('Lineup not found');
    // D8: a "go vote" DM about a poll that cannot accept votes is a lie.
    assertPollOpen(match, lineup);
    // AC4: the exact predicate the lock-in gate uses, same exception class.
    if (!isPollOrganiser(lineup, caller)) {
      throw new ForbiddenException(
        'Only the poll creator or an operator can rally voters',
      );
    }
  }

  /**
   * Claim the per-poll 6h window.
   *
   * @param matchId - The poll being rallied.
   * @returns ISO instant before which a further rally is refused.
   * @throws HttpException 429 when the window is already claimed.
   */
  private async armCooldown(matchId: number): Promise<string> {
    const onCooldown = await this.dedupService.checkAndMarkSent(
      rallyCooldownKey(matchId),
      POLL_RALLY_COOLDOWN_SECONDS,
    );
    if (onCooldown) {
      throw new HttpException(
        'You rallied this poll recently — try again later',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return new Date(
      Date.now() + POLL_RALLY_COOLDOWN_SECONDS * 1000,
    ).toISOString();
  }

  /**
   * §3.6: burning six hours to learn "nobody to rally" is a trap, so an
   * empty audience gives the key back. D7's race safety is unaffected — the
   * loser of a race also sees an empty audience and releases an
   * already-released key, which is a no-op.
   *
   * @param matchId - The poll whose cooldown key is being returned.
   * @returns The zero-audience response body.
   */
  private async refundCooldown(
    matchId: number,
  ): Promise<RallyNonVotersResponseDto> {
    await this.dedupService.releaseKey(rallyCooldownKey(matchId));
    return {
      pending: 0,
      nudged: 0,
      skipped: 0,
      cooldownUntil: new Date().toISOString(),
    };
  }

  /**
   * Fan the nudge out, isolating per-recipient failures: one failed create
   * must not 500 the whole rally after earlier DMs already went out.
   *
   * @param poll - Poll supplying the copy and the notification payload.
   * @param userIds - Audience, actor already removed.
   * @returns How many DMs were created vs suppressed/failed.
   */
  private async dispatch(
    poll: NudgePoll,
    userIds: number[],
  ): Promise<{ nudged: number; skipped: number }> {
    const deps = {
      notificationService: this.notificationService,
      dedupService: this.dedupService,
    };
    let nudged = 0;
    let skipped = 0;
    for (const userId of userIds) {
      try {
        const result = await sendPollNudge(deps, poll, userId);
        // `created` is the only true send: a member the shared 24h key
        // already covered, or whose preferences suppressed the DM, is
        // `skipped` — exactly the contract's definition.
        if (result.created) nudged++;
        else skipped++;
      } catch (err) {
        skipped++;
        // `sendPollNudge` marks the shared 24h key BEFORE dispatching, so a
        // failed send would otherwise cost this member the window from BOTH
        // the next rally and the cron. Only a THROWN dispatch is released: a
        // deduped or preference-suppressed member keeps their claim.
        await this.releaseQuietly(pollNudgeKey(poll.matchId, userId));
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Rally failed for match ${poll.matchId} user ${userId}: ${msg}`,
        );
      }
    }
    return { nudged, skipped };
  }
}

/**
 * Organiser "Rally" nudge for scheduling polls (ROK-1618).
 *
 * A separate injectable (not more `SchedulingService` methods) to respect the
 * 300-line file cap, and deliberately NOT part of `SchedulingRemindService`:
 * the two actions differ in audience resolver and in cooldown length.
 *
 * The rally asks ONE question — "does THIS time work for you?" — so its
 * audience is everyone with no stance (yes or no) on that one slot. It is NOT
 * the recurring cron nudge's audience: a poll at 3 of 4 YES on the rallied
 * time still has one person to chase even when that person voted on another
 * day, and reporting "everyone has voted" there was the operator-rejected bug.
 *
 *   - slot     -> the caller's `slotId` (ROK-1635: Rally on a time card asks
 *     about THAT card), or `findLeadingFutureSlot` when none is named, so the
 *     legacy DM and the "Lock in …" button still name the same time;
 *   - audience -> `findLeaderPendingMemberIds` (this feature's own query);
 *   - dispatch -> `sendRallyDm`, marking the rally's OWN 6h per-member key, so
 *     a rally never spends the cron's 24h budget in either direction;
 *   - cooldown -> `NotificationDedupService.checkAndMarkSent` (D3/D7), the
 *     same atomic mechanism `SchedulingRemindService` uses for its 1h gate.
 */
import {
  BadRequestException,
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
import {
  findLeadingFutureSlot,
  type LeadingSlot,
} from './scheduling-poll-expiry.helpers';
import {
  countPollMembers,
  findLeaderPendingMemberIds,
  findSlotInMatch,
  rallyCooldownKey,
  rallyMemberKey,
  sendRallyDm,
} from './scheduling-rally.helpers';
import {
  loadNudgePollById,
  type NudgePoll,
} from './scheduling-poll-nudge.helpers';

interface Caller {
  id: number;
  role?: string;
}

/** The poll, its size and the members who owe an answer on the rallied slot. */
interface RallyAudience {
  poll: NudgePoll;
  memberCount: number;
  userIds: number[];
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
   * DM every poll member with no stance on ONE future slot, asking whether
   * that time works.
   *
   * ROK-1635: the slot is the caller's to choose — Rally on any time card
   * rallies THAT card's time. With no `slotId` the rally falls back to the
   * LEADING slot, which is what every pre-ROK-1635 client asks for.
   *
   * Organiser-only (creator, admin or operator); 6h per-poll cooldown (429
   * when armed); 6h per-(poll, slot, member) dedup owned by the rally.
   *
   * @param lineupId - Lineup from the URL, cross-checked against the match.
   * @param matchId - The scheduling poll being rallied.
   * @param caller - The authenticated caller and their role.
   * @param slotId - The time being rallied; omitted means "the leading time".
   * @returns Counts for the organiser's toast; `pending === nudged + skipped`.
   */
  async rallyNonVoters(
    lineupId: number,
    matchId: number,
    caller: Caller,
    slotId?: number,
  ): Promise<RallyNonVotersResponseDto> {
    await this.loadAndGuard(lineupId, matchId, caller);
    // Resolve the target BEFORE arming, so a rally with nothing to ask about
    // — or naming a slot the server rejects — never burns (or churns) the 6h
    // key. Precedent: `warnOne` resolves the leading slot before its dedup.
    const target = await this.resolveTargetSlot(matchId, slotId);
    // D7: arm BEFORE any audience work, so two concurrent presses cannot
    // both fan out. `checkAndMarkSent` is atomic (Redis + ON CONFLICT).
    const cooldownUntil = await this.armCooldown(matchId);
    const audience = await this.resolveAudience(matchId, target, caller);
    if (audience.userIds.length === 0) return this.refundCooldown(matchId);

    const { nudged, skipped } = await this.dispatch(audience, target);
    return { pending: audience.userIds.length, nudged, skipped, cooldownUntil };
  }

  /**
   * The slot this rally asks about: the one the caller named, or the leader.
   *
   * The leader floor (`findLeadingFutureSlot`'s "more yes than no") applies
   * ONLY to the default path. A named card with no votes at all is precisely
   * the time an organiser wants to chase, so it must not be refused — but it
   * must still belong to this poll and still be in the future (ROK-1607),
   * because a stale client can name a slot that is neither.
   *
   * @param matchId - The poll being rallied.
   * @param slotId - The time named by the caller, if any.
   * @returns The slot the DM and the audience query both use.
   * @throws NotFoundException / BadRequestException, before any cooldown.
   */
  private async resolveTargetSlot(
    matchId: number,
    slotId?: number,
  ): Promise<LeadingSlot> {
    if (slotId === undefined) {
      const leader = await findLeadingFutureSlot(this.db, matchId);
      // ROK-1617 item D: the message names the CAUSE, because the floor now
      // rejects answered-but-negative polls too, not just untouched ones.
      if (!leader) {
        throw new BadRequestException(
          'No leading time yet — no time has more yes votes than no votes',
        );
      }
      return leader;
    }
    const slot = await findSlotInMatch(this.db, matchId, slotId);
    if (!slot) throw new NotFoundException('Time not found in this poll');
    if (new Date(slot.proposedTime).getTime() <= Date.now()) {
      throw new BadRequestException('That time has already passed');
    }
    return slot;
  }

  /**
   * Load the poll and resolve who still owes an answer on the rallied slot,
   * AFTER the cooldown is armed (D7 — two concurrent presses must not both
   * fan out).
   *
   * `assertPollOpen` is a looser predicate than the nudgeable-polls SQL (a
   * `voting` lineup with a `suggested` match passes the guard but matches no
   * row), and this step can also fail on the database. Either way nobody was
   * DM'd, so the just-claimed 6h key is given back rather than locking the
   * organiser out for nothing. Precedent: `SchedulingPollExpiryService.warnOne`.
   *
   * @param matchId - The poll being rallied.
   * @param target - The slot the rally asks about.
   * @param caller - The authenticated caller, removed from the audience.
   * @returns The nudgeable poll, its member count and the reachable members.
   * @throws The original error, with the cooldown released.
   */
  private async resolveAudience(
    matchId: number,
    target: LeadingSlot,
    caller: Caller,
  ): Promise<RallyAudience> {
    try {
      const poll = await loadNudgePollById(this.db, matchId);
      // The poll stopped being nudgeable between the guard and here.
      if (!poll) throw new NotFoundException('Match not found');
      const memberCount = await countPollMembers(this.db, matchId);
      // The actor is filtered out of the AUDIENCE, not merely skipped during
      // dispatch, so `pending` counts only members a DM could reach and the
      // `pending === nudged + skipped` invariant holds.
      const userIds = (
        await findLeaderPendingMemberIds(this.db, matchId, target.slotId)
      ).filter((userId) => userId !== caller.id);
      return { poll, memberCount, userIds };
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
   * Fan the DM out, isolating per-recipient failures: one failed create must
   * not 500 the whole rally after earlier DMs already went out.
   *
   * @param audience - Poll, member count and recipients (actor removed).
   * @param target - The slot the DM asks about.
   * @returns How many DMs were created vs suppressed/failed.
   */
  private async dispatch(
    audience: RallyAudience,
    target: LeadingSlot,
  ): Promise<{ nudged: number; skipped: number }> {
    let nudged = 0;
    let skipped = 0;
    for (const userId of audience.userIds) {
      const sent = await this.dispatchOne(audience, target, userId);
      if (sent) nudged++;
      else skipped++;
    }
    return { nudged, skipped };
  }

  /**
   * One recipient's DM, swallowing its failure into a `skipped`.
   *
   * @param audience - Poll and member count for the copy.
   * @param target - The slot the DM asks about.
   * @param userId - Recipient.
   * @returns True only when a notification row was created.
   */
  private async dispatchOne(
    audience: RallyAudience,
    target: LeadingSlot,
    userId: number,
  ): Promise<boolean> {
    const deps = {
      notificationService: this.notificationService,
      dedupService: this.dedupService,
    };
    const { poll, memberCount } = audience;
    try {
      // `created` is the only true send: a member the rally's own 6h key
      // already covered, or whose preferences suppressed the DM, is `skipped`
      // — exactly the contract's definition.
      const result = await sendRallyDm(deps, poll, target, memberCount, userId);
      return result.created;
    } catch (err) {
      // `sendRallyDm` marks the 6h key BEFORE dispatching, so a failed send
      // would otherwise cost this member the whole window. Only a THROWN
      // dispatch is released: a deduped or preference-suppressed member keeps
      // their claim.
      await this.releaseQuietly(
        rallyMemberKey(poll.matchId, target.slotId, userId),
      );
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Rally failed for match ${poll.matchId} user ${userId}: ${msg}`,
      );
      return false;
    }
  }
}

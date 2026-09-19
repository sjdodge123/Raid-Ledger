/**
 * Scheduling poll service (ROK-965).
 * Manages time slot suggestions, voting, and event creation for match groups.
 */
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  ScheduleVoteStance,
  ToggleScheduleVoteResponseDto,
  SchedulePollPageResponseDto,
  SchedulingBannerDto,
  OtherPollsResponseDto,
  AggregateGameTimeResponse,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { EventsService } from '../../events/events.service';
import { SignupsService } from '../../events/signups.service';
import {
  insertScheduleSlot,
  insertScheduleVote,
  updateScheduleVoteStance,
  findVoteBySlotAndUser,
  deleteScheduleVote,
  deleteAllUserVotesForMatch,
  findUserSchedulingMatches,
  ensureMatchMember,
} from './scheduling-query.helpers';
import {
  loadSchedulePollInputs,
  assembleSchedulePollResponse,
} from './scheduling-poll-page.helpers';
import {
  assertMayLockInSlot,
  assertSlotStillVotable,
} from './scheduling-lock-in.helpers';
import { buildSchedulingAvailability } from './scheduling-availability.helpers';
import {
  findMatchById,
  findMatchMembers,
} from '../lineups-match-query.helpers';
import { buildBannerForUser } from './scheduling-banner.helpers';
import { LineupNotificationService } from '../lineup-notification.service';
import { SchedulingPollEmbedService } from './scheduling-poll-embed.service';
import { syncSchedulingSubmittedAt } from './scheduling-submitted-at.helpers';
import {
  findSlotOrThrow,
  createLockedInEvent,
} from './scheduling-event.helpers';
import {
  assertSchedulingEnabled,
  assertSchedulable,
  assertSlotBelongsToMatch,
  assertNoDuplicateSlot,
  assertCallerMayVote,
} from './scheduling-guard.helpers';
import {
  archiveAndNotifyCancel,
  normalizeReason,
} from './scheduling-cancel.helpers';
import { NotificationService } from '../../notifications/notification.service';
import {
  resolveStanceAction,
  isAnswering,
  type StanceAction,
} from './scheduling-stance.helpers';

@Injectable()
export class SchedulingService {
  private readonly logger = new Logger(SchedulingService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly eventsService: EventsService,
    private readonly signupsService: SignupsService,
    private readonly lineupNotifications: LineupNotificationService,
    private readonly pollEmbed: SchedulingPollEmbedService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Get the full scheduling poll page data for a match.
   *
   * ROK-1306: validates the match belongs to the URL's lineup so a stale
   * `matchId` from another lineup can't be served under a different lineup's
   * URL (which previously surfaced the wrong game's poll on the page).
   */
  async getSchedulePoll(
    lineupId: number,
    matchId: number,
    userId: number | null,
    callerRole: string | null = null,
  ): Promise<SchedulePollPageResponseDto> {
    const match = await this.findMatchOrThrow(matchId);
    if (match.lineupId !== lineupId) {
      throw new NotFoundException('Match not found in this lineup');
    }
    const { pollMatch, lineup, members, slots, voterCount } =
      await loadSchedulePollInputs(this.db, match, matchId);
    // ROK-1302: a lineup that opted out of the scheduling phase has no poll —
    // 404 the page (the decided UI already hides the CTA; this guards a
    // hand-crafted URL or the lazy slot-create path).
    if (lineup && lineup.includeSchedulingPhase === false) {
      throw new NotFoundException('Scheduling is disabled for this lineup');
    }
    return assembleSchedulePollResponse(
      this.db,
      { pollMatch, lineup, members, slots, voterCount },
      userId,
      callerRole,
    );
  }

  /** Suggest a new time slot for a match and auto-vote for it. */
  async suggestSlot(
    matchId: number,
    proposedTime: string,
    userId?: number,
    callerRole?: string,
  ): Promise<{ id: number }> {
    const match = await this.findMatchOrThrow(matchId);
    assertSchedulingEnabled(match);
    assertSchedulable(match);
    if (userId) {
      await assertCallerMayVote(
        this.db,
        match.lineupId,
        { id: userId, role: callerRole },
        match,
      );
    }
    const proposed = new Date(proposedTime);
    if (proposed < new Date()) {
      throw new BadRequestException('Cannot suggest a time in the past');
    }
    await assertNoDuplicateSlot(this.db, matchId, proposed);
    const [slot] = await insertScheduleSlot(this.db, matchId, proposed, 'user');
    if (userId) await this.autoVoteForSlot(slot.id, matchId, userId);
    this.pollEmbed.fireUpdateEmbed(matchId);
    return { id: slot.id };
  }

  /**
   * Auto-vote for a newly suggested slot and enroll the suggester as a
   * member — atomically, so a partial failure can't leave a voter without
   * membership (they couldn't self-heal: re-suggesting 400s on the 15-min
   * duplicate window). A failure never blocks the suggest itself; the
   * suggester can still tap the slot to vote, which enrolls them.
   */
  private async autoVoteForSlot(
    slotId: number,
    matchId: number,
    userId: number,
  ): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        await insertScheduleVote(tx, slotId, userId);
        await ensureMatchMember(tx, matchId, userId);
        // ROK-1544: the auto-vote is a real vote, so it stamps like one —
        // on the SAME tx, so the stamp can never outlive a rolled-back vote.
        await syncSchedulingSubmittedAt(tx, matchId, userId);
      });
    } catch (err) {
      this.logger.warn(
        'Auto-vote failed for slot %d user %d: %s',
        slotId,
        userId,
        err,
      );
    }
  }

  /**
   * Toggle a member's stance on a schedule slot (ROK-965, ROK-1617).
   *
   * Uses insert-first logic: INSERT ON CONFLICT DO NOTHING is atomic,
   * eliminating the check-then-insert race condition (ROK-1017). An empty
   * return means a row already existed, and the stance rule then decides
   * between changing it and clearing it.
   *
   * @param slotId - Slot being answered.
   * @param userId - The voting member.
   * @param matchId - Match the slot must belong to.
   * @param callerRole - Role, for the private-lineup vote guard.
   * @param stance - `'yes'` (default, the pre-stance behaviour) or `'no'`.
   * @returns Whether the caller now holds a YES, and their resulting stance.
   */
  async toggleVote(
    slotId: number,
    userId: number,
    matchId: number,
    callerRole?: string,
    stance: ScheduleVoteStance = 'yes',
  ): Promise<ToggleScheduleVoteResponseDto> {
    const match = await this.findMatchOrThrow(matchId);
    assertSchedulingEnabled(match);
    assertSchedulable(match);
    await assertCallerMayVote(
      this.db,
      match.lineupId,
      { id: userId, role: callerRole },
      match,
    );
    const slot = await assertSlotBelongsToMatch(this.db, slotId, matchId);
    // Vote write + member enrollment + the ROK-1544 stamp all commit
    // atomically. A partial write would recreate the voter-without-membership
    // state this fixes, and a stamp outside the tx could 500 a request whose
    // vote already committed (client rolls back a vote the server holds).
    const action = await this.db.transaction(async (tx) => {
      const resolved = await this.applyStance(tx, slotId, userId, stance);
      // ROK-1607, extended to stances by ROK-1617: a time that has passed
      // cannot be answered — but it can still be UN-answered, so a member who
      // voted for Friday can untick it on Saturday. Throwing rolls the write
      // back; the statement itself succeeded, so nothing is poisoned.
      if (isAnswering(resolved)) {
        assertSlotStillVotable(slot.proposedTime);
        await ensureMatchMember(tx, matchId, userId);
      }
      // The tap IS the submit — reconcile the member's stamp with the votes
      // they now hold (first answer stamps, last withdrawal clears). Last
      // statement, so it sees this tx's own write.
      await syncSchedulingSubmittedAt(tx, matchId, userId);
      return resolved;
    });
    this.pollEmbed.fireUpdateEmbed(matchId);
    return { voted: action.stance === 'yes', stance: action.stance };
  }

  /**
   * Perform the one write the stance rule calls for (ROK-1617 AC2).
   *
   * Insert-first keeps ROK-1017's race fix: the INSERT is the probe. Only when
   * it conflicts do we read the existing stance, and even then the write is an
   * UPDATE or a DELETE — never a second row, which `uq_schedule_vote_user`
   * would reject anyway.
   *
   * @param tx - The caller's transaction handle.
   * @param slotId - Slot being answered.
   * @param userId - The voting member.
   * @param stance - The stance pressed.
   * @returns The transition that was applied.
   */
  private async applyStance(
    tx: PostgresJsDatabase<typeof schema>,
    slotId: number,
    userId: number,
    stance: ScheduleVoteStance,
  ): Promise<StanceAction> {
    const inserted = await insertScheduleVote(tx, slotId, userId, stance);
    if (inserted.length > 0) return resolveStanceAction(null, stance);
    const [existing] = await findVoteBySlotAndUser(tx, slotId, userId);
    // The conflict PROVED a row exists, and we read it in the same
    // transaction, so a missing stance is a pre-stance row — which means
    // 'yes'. Never null here: null would mean "nothing on record" and would
    // make this tap re-insert a row the unique constraint already holds.
    const action = resolveStanceAction(existing?.stance ?? 'yes', stance);
    if (action.kind === 'cleared') {
      // DELETE cannot violate a constraint, so no catch-and-retry is needed.
      await deleteScheduleVote(tx, slotId, userId);
    } else if (action.kind === 'changed') {
      await updateScheduleVoteStance(tx, slotId, userId, action.stance);
    }
    return action;
  }

  /** Retract all votes by a user for slots belonging to a match. */
  async retractAllVotes(matchId: number, userId: number): Promise<void> {
    const match = await this.findMatchOrThrow(matchId);
    assertSchedulingEnabled(match);
    assertSchedulable(match);
    // ROK-1544: no votes left → the member has no answer on record again.
    // Delete + stamp share one tx so the two can never diverge.
    await this.db.transaction(async (tx) => {
      await deleteAllUserVotesForMatch(tx, matchId, userId);
      await syncSchedulingSubmittedAt(tx, matchId, userId);
    });
    this.pollEmbed.fireUpdateEmbed(matchId);
  }

  /**
   * Create an event from a schedule slot — the lock-in.
   *
   * ROK-1610: this works on an EXPIRED poll too, so a group whose deadline
   * slipped can still be scheduled at a time its members already voted for,
   * without re-polling. Only the slot's voters are signed up (unchanged), and
   * they are rostered (ROK-1606).
   */
  async createEventFromSlot(
    matchId: number,
    slotId: number,
    userId: number,
    recurring: boolean = false,
    callerRole?: string,
  ): Promise<{ eventId: number }> {
    const match = await this.findMatchOrThrow(matchId);
    assertSchedulingEnabled(match);
    if (match.linkedEventId) {
      throw new BadRequestException('Event already created for this match');
    }
    const slot = await findSlotOrThrow(this.db, slotId);
    await assertMayLockInSlot(this.db, match, matchId, slot, {
      id: userId,
      role: callerRole,
    });
    return {
      eventId: await createLockedInEvent(
        {
          db: this.db,
          eventsService: this.eventsService,
          signupsService: this.signupsService,
          lineupNotifications: this.lineupNotifications,
          pollEmbed: this.pollEmbed,
          logger: this.logger,
        },
        match,
        slot,
        userId,
        recurring,
      ),
    };
  }

  /**
   * Get heatmap availability data (fresh/stale/unknown) for a match's members.
   *
   * @param matchId - The scheduling match the heatmap belongs to.
   * @param viewerUserId - Viewer, for the freshness banner. Optional.
   * @param weekStart - Sunday 00:00 UTC of the week to paint (ROK-1570). The
   *   members' dated signups and absences in that week are subtracted from
   *   their templates. `undefined` = the current week.
   */
  async getMatchAvailability(
    matchId: number,
    viewerUserId?: number,
    weekStart?: Date,
    tzOffset = 0,
  ): Promise<AggregateGameTimeResponse> {
    const members = await findMatchMembers(this.db, [matchId]);
    return buildSchedulingAvailability(
      this.db,
      members.map((m) => m.userId),
      matchId,
      viewerUserId,
      weekStart,
      tzOffset,
    );
  }

  /** Get the scheduling banner for the events page. */
  async getSchedulingBanner(
    userId: number,
  ): Promise<SchedulingBannerDto | null> {
    return buildBannerForUser(this.db, userId);
  }

  /** Get other scheduling polls the user is a member of. */
  async getOtherPolls(
    lineupId: number,
    excludeMatchId: number,
    userId: number,
  ): Promise<OtherPollsResponseDto> {
    const matches = await findUserSchedulingMatches(this.db, lineupId, userId);
    const polls = matches
      .filter((m) => m.matchId !== excludeMatchId)
      .map((m) => ({
        matchId: m.matchId,
        gameName: m.gameName,
        gameCoverUrl: m.gameCoverUrl,
        memberCount: m.memberCount,
      }));
    return { polls };
  }

  /**
   * Cancel/archive a scheduling poll (operator). Archives first (source of
   * truth), then notifies matched voters except the actor. Notification
   * dispatch is fire-safe — a failure is logged, never thrown (ROK-1219).
   */
  async cancelPoll(
    matchId: number,
    actorUserId: number,
    reason?: string | null,
  ): Promise<void> {
    const match = await this.findMatchOrThrow(matchId);
    assertSchedulingEnabled(match);
    assertSchedulable(match);
    await archiveAndNotifyCancel(
      { db: this.db, notifications: this.notifications, logger: this.logger },
      match,
      actorUserId,
      normalizeReason(reason),
    );
    // ROK-1461: archived — re-render so the embed shows "POLL CLOSED".
    this.pollEmbed.fireUpdateEmbed(matchId);
  }

  // -- Private helpers --

  private async findMatchOrThrow(matchId: number) {
    const [match] = await findMatchById(this.db, matchId);
    if (!match) throw new NotFoundException('Match not found');
    return match;
  }
}

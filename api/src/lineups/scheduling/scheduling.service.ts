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
  findScheduleSlots,
  findScheduleVotes,
  insertScheduleSlot,
  insertScheduleVote,
  deleteScheduleVote,
  updateMatchLinkedEvent,
  deleteAllUserVotesForMatch,
  findUserSchedulingMatches,
  countUniqueVoters,
  findLineupPollMeta,
  ensureMatchMember,
} from './scheduling-query.helpers';
import { buildSchedulingAvailability } from './scheduling-availability.helpers';
import {
  findMatchById,
  findMatchMembers,
} from '../lineups-match-query.helpers';
import {
  buildPollResponse,
  deriveIsStandalone,
} from './scheduling-response.helpers';
import { buildBannerForUser } from './scheduling-banner.helpers';
import { fireEventCreated } from '../lineups-notify-hooks.helpers';
import { LineupNotificationService } from '../lineup-notification.service';
import { SchedulingPollEmbedService } from './scheduling-poll-embed.service';
import { autoSignupSlotVoters } from './scheduling-auto-signup.helpers';
import { insertPollInterests } from './scheduling-auto-heart.helpers';
import { findSlotConflicts } from './scheduling-conflict.helpers';
import {
  findSlotOrThrow,
  resolveGameInfo,
  buildCreateEventDto,
  assertUserHasVoted,
} from './scheduling-event.helpers';
import {
  assertSchedulingEnabled,
  assertSchedulable,
  assertSlotBelongsToMatch,
  assertNoDuplicateSlot,
} from './scheduling-guard.helpers';
import {
  archiveAndNotifyCancel,
  normalizeReason,
} from './scheduling-cancel.helpers';
import { NotificationService } from '../../notifications/notification.service';

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
  ): Promise<SchedulePollPageResponseDto> {
    const match = await this.findMatchOrThrow(matchId);
    if (match.lineupId !== lineupId) {
      throw new NotFoundException('Match not found in this lineup');
    }
    const [gameInfo, [lineup], members, slots, voterCount] = await Promise.all([
      resolveGameInfo(this.db, match.gameId),
      findLineupPollMeta(this.db, match.lineupId),
      findMatchMembers(this.db, [matchId]),
      findScheduleSlots(this.db, matchId),
      countUniqueVoters(this.db, matchId),
    ]);
    // ROK-1302: a lineup that opted out of the scheduling phase has no poll —
    // 404 the page (the decided UI already hides the CTA; this guards a
    // hand-crafted URL or the lazy slot-create path).
    if (lineup && lineup.includeSchedulingPhase === false) {
      throw new NotFoundException('Scheduling is disabled for this lineup');
    }
    const slotIds = slots.map((s) => s.id);
    const votes = await findScheduleVotes(this.db, slotIds);
    const slotConflicts = userId
      ? await findSlotConflicts(this.db, userId, slots)
      : undefined;
    const conflictingSlotIds = slotConflicts?.map((c) => c.slotId);
    return {
      ...buildPollResponse(
        { ...match, ...gameInfo, lineupCreatedById: lineup?.createdBy ?? null },
        members,
        slots,
        votes,
        userId,
        lineup?.status ?? 'decided',
        deriveIsStandalone(lineup?.phaseDurationOverride),
      ),
      uniqueVoterCount: voterCount,
      conflictingSlotIds,
      slotConflicts,
      phaseDeadline: lineup?.phaseDeadline
        ? lineup.phaseDeadline.toISOString()
        : null,
    };
  }

  /** Suggest a new time slot for a match and auto-vote for it. */
  async suggestSlot(
    matchId: number,
    proposedTime: string,
    userId?: number,
  ): Promise<{ id: number }> {
    const match = await this.findMatchOrThrow(matchId);
    assertSchedulingEnabled(match);
    assertSchedulable(match);
    const proposed = new Date(proposedTime);
    if (proposed < new Date()) {
      throw new BadRequestException('Cannot suggest a time in the past');
    }
    await assertNoDuplicateSlot(this.db, matchId, proposed);
    const [slot] = await insertScheduleSlot(this.db, matchId, proposed, 'user');
    if (userId) {
      await this.autoVoteForSlot(slot.id, userId);
      await ensureMatchMember(this.db, matchId, userId);
    }
    this.pollEmbed.fireUpdateEmbed(matchId);
    return { id: slot.id };
  }

  /** Auto-vote for a newly suggested slot. */
  private async autoVoteForSlot(slotId: number, userId: number): Promise<void> {
    try {
      await insertScheduleVote(this.db, slotId, userId);
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
   * Toggle a vote on a schedule slot. Returns voted state.
   * Uses insert-first logic: INSERT ON CONFLICT DO NOTHING is atomic,
   * eliminating the check-then-insert race condition (ROK-1017).
   */
  async toggleVote(
    slotId: number,
    userId: number,
    matchId: number,
  ): Promise<{ voted: boolean }> {
    const match = await this.findMatchOrThrow(matchId);
    assertSchedulingEnabled(match);
    assertSchedulable(match);
    await assertSlotBelongsToMatch(this.db, slotId, matchId);
    // Vote + member enrollment commit atomically — a partial write would
    // recreate the voter-without-membership state this fixes.
    const inserted = await this.db.transaction(async (tx) => {
      const rows = await insertScheduleVote(tx, slotId, userId);
      if (rows.length > 0) await ensureMatchMember(tx, matchId, userId);
      return rows;
    });
    if (inserted.length > 0) {
      this.pollEmbed.fireUpdateEmbed(matchId);
      return { voted: true };
    }
    await deleteScheduleVote(this.db, slotId, userId);
    this.pollEmbed.fireUpdateEmbed(matchId);
    return { voted: false };
  }

  /** Retract all votes by a user for slots belonging to a match. */
  async retractAllVotes(matchId: number, userId: number): Promise<void> {
    const match = await this.findMatchOrThrow(matchId);
    assertSchedulingEnabled(match);
    assertSchedulable(match);
    await deleteAllUserVotesForMatch(this.db, matchId, userId);
    this.pollEmbed.fireUpdateEmbed(matchId);
  }

  /** Create an event from a schedule slot. */
  async createEventFromSlot(
    matchId: number,
    slotId: number,
    userId: number,
    recurring: boolean = false,
  ): Promise<{ eventId: number }> {
    const match = await this.findMatchOrThrow(matchId);
    assertSchedulingEnabled(match);
    if (match.linkedEventId) {
      throw new BadRequestException('Event already created for this match');
    }
    await assertUserHasVoted(this.db, matchId, userId);
    const slot = await findSlotOrThrow(this.db, slotId);
    const { gameName } = await resolveGameInfo(this.db, match.gameId);
    const dto = buildCreateEventDto(
      gameName,
      match.gameId,
      slot.proposedTime,
      recurring,
    );
    const event = await this.eventsService.create(userId, dto);
    await updateMatchLinkedEvent(this.db, matchId, event.id);
    const voters = await findScheduleVotes(this.db, [slotId]);
    await autoSignupSlotVoters({
      eventId: event.id,
      creatorId: userId,
      voters,
      signupsService: this.signupsService,
    });
    this.fireAutoHeart(match.gameId, voters);
    fireEventCreated(
      this.lineupNotifications,
      this.logger,
      this.db,
      matchId,
      slot.proposedTime,
      event.id,
    );
    return { eventId: event.id };
  }

  /** Get heatmap availability data for a match's members. */
  async getMatchAvailability(
    matchId: number,
  ): Promise<AggregateGameTimeResponse> {
    const members = await findMatchMembers(this.db, [matchId]);
    return buildSchedulingAvailability(
      this.db,
      members.map((m) => m.userId),
      matchId,
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
  }

  // -- Private helpers --

  /** Fire-and-forget auto-heart for poll voters. */
  private fireAutoHeart(gameId: number, voters: { userId: number }[]): void {
    const voterUserIds = [...new Set(voters.map((v) => v.userId))];
    insertPollInterests({ db: this.db, gameId, voterUserIds }).catch(
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Auto-heart poll interests failed: ${msg}`);
      },
    );
  }

  private async findMatchOrThrow(matchId: number) {
    const [match] = await findMatchById(this.db, matchId);
    if (!match) throw new NotFoundException('Match not found');
    return match;
  }
}

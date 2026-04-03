/**
 * Scheduling poll service (ROK-965).
 * Manages time slot suggestions, voting, and event creation for match groups.
 */
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { eq, and, gte, lte } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  CreateEventDto,
  SchedulePollPageResponseDto,
  SchedulingBannerDto,
  OtherPollsResponseDto,
  AggregateGameTimeResponse,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { EventsService } from '../../events/events.service';
import {
  findScheduleSlots,
  findScheduleVotes,
  insertScheduleSlot,
  insertScheduleVote,
  deleteScheduleVote,
  findVoteBySlotAndUser,
  updateMatchLinkedEvent,
  deleteAllUserVotesForMatch,
  findUserSchedulingMatches,
} from './scheduling-query.helpers';
import { buildSchedulingAvailability } from './scheduling-availability.helpers';
import {
  findMatchById,
  findMatchMembers,
} from '../lineups-match-query.helpers';
import { buildPollResponse } from './scheduling-response.helpers';
import { buildBannerForUser } from './scheduling-banner.helpers';
import { fireEventCreated } from '../lineups-notify-hooks.helpers';
import { LineupNotificationService } from '../lineup-notification.service';

const DUPLICATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const EVENT_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours
const FOUR_WEEKS_MS = 4 * 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class SchedulingService {
  private readonly logger = new Logger(SchedulingService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly eventsService: EventsService,
    private readonly lineupNotifications: LineupNotificationService,
  ) {}

  /** Get the full scheduling poll page data for a match. */
  async getSchedulePoll(
    matchId: number,
    userId: number | null,
  ): Promise<SchedulePollPageResponseDto> {
    const match = await this.findMatchOrThrow(matchId);
    const [gameInfo, [lineup], members, slots] = await Promise.all([
      this.resolveGameInfo(match.gameId),
      this.db
        .select({ status: schema.communityLineups.status })
        .from(schema.communityLineups)
        .where(eq(schema.communityLineups.id, match.lineupId))
        .limit(1),
      findMatchMembers(this.db, [matchId]),
      findScheduleSlots(this.db, matchId),
    ]);
    const slotIds = slots.map((s) => s.id);
    const votes = await findScheduleVotes(this.db, slotIds);
    return buildPollResponse(
      { ...match, ...gameInfo },
      members,
      slots,
      votes,
      userId,
      lineup?.status ?? 'decided',
    );
  }

  /** Suggest a new time slot for a match and auto-vote for it. */
  async suggestSlot(
    matchId: number,
    proposedTime: string,
    userId?: number,
  ): Promise<{ id: number }> {
    const match = await this.findMatchOrThrow(matchId);
    this.assertSchedulable(match);
    const proposed = new Date(proposedTime);
    if (proposed < new Date()) {
      throw new BadRequestException('Cannot suggest a time in the past');
    }
    await this.assertNoDuplicateSlot(matchId, proposed);
    const [slot] = await insertScheduleSlot(this.db, matchId, proposed, 'user');
    if (userId) await this.autoVoteForSlot(slot.id, userId);
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

  /** Toggle a vote on a schedule slot. Returns voted state. */
  async toggleVote(
    slotId: number,
    userId: number,
    matchId: number,
  ): Promise<{ voted: boolean }> {
    const match = await this.findMatchOrThrow(matchId);
    this.assertSchedulable(match);
    const existing = await findVoteBySlotAndUser(this.db, slotId, userId);
    if (existing.length > 0) {
      await deleteScheduleVote(this.db, slotId, userId);
      return { voted: false };
    }
    await insertScheduleVote(this.db, slotId, userId);
    return { voted: true };
  }

  /** Retract all votes by a user for slots belonging to a match. */
  async retractAllVotes(matchId: number, userId: number): Promise<void> {
    const match = await this.findMatchOrThrow(matchId);
    this.assertSchedulable(match);
    await deleteAllUserVotesForMatch(this.db, matchId, userId);
  }

  /** Create an event from a schedule slot. */
  async createEventFromSlot(
    matchId: number,
    slotId: number,
    userId: number,
    recurring: boolean = false,
  ): Promise<{ eventId: number }> {
    const match = await this.findMatchOrThrow(matchId);
    if (match.linkedEventId) {
      throw new BadRequestException('Event already created for this match');
    }
    await this.assertUserHasVoted(matchId, userId);
    const slot = await this.findSlotOrThrow(slotId);
    const gameName = await this.resolveGameName(match.gameId);
    const dto = this.buildCreateEventDto(
      gameName,
      match.gameId,
      slot.proposedTime,
      recurring,
    );
    const event = await this.eventsService.create(userId, dto);
    await updateMatchLinkedEvent(this.db, matchId, event.id);
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

  // -- Private helpers --

  private async findMatchOrThrow(matchId: number) {
    const [match] = await findMatchById(this.db, matchId);
    if (!match) throw new NotFoundException('Match not found');
    return match;
  }

  private assertSchedulable(match: { status: string }): void {
    if (match.status !== 'scheduling' && match.status !== 'suggested') {
      throw new BadRequestException(
        'This match is no longer accepting changes',
      );
    }
  }

  private async assertUserHasVoted(
    matchId: number,
    userId: number,
  ): Promise<void> {
    const slots = await findScheduleSlots(this.db, matchId);
    for (const slot of slots) {
      const votes = await findVoteBySlotAndUser(this.db, slot.id, userId);
      if (votes.length > 0) return;
    }
    throw new ForbiddenException(
      'You must vote on a slot before creating an event',
    );
  }

  private async assertNoDuplicateSlot(
    matchId: number,
    proposed: Date,
  ): Promise<void> {
    const windowStart = new Date(proposed.getTime() - DUPLICATE_WINDOW_MS);
    const windowEnd = new Date(proposed.getTime() + DUPLICATE_WINDOW_MS);
    const [dup] = await this.db
      .select({ id: schema.communityLineupScheduleSlots.id })
      .from(schema.communityLineupScheduleSlots)
      .where(
        and(
          eq(schema.communityLineupScheduleSlots.matchId, matchId),
          gte(schema.communityLineupScheduleSlots.proposedTime, windowStart),
          lte(schema.communityLineupScheduleSlots.proposedTime, windowEnd),
        ),
      )
      .limit(1);
    if (dup)
      throw new BadRequestException('A slot within 15 minutes already exists');
  }

  private async findSlotOrThrow(slotId: number) {
    const [slot] = await this.db
      .select()
      .from(schema.communityLineupScheduleSlots)
      .where(eq(schema.communityLineupScheduleSlots.id, slotId))
      .limit(1);
    if (!slot) throw new NotFoundException('Slot not found');
    return slot;
  }

  private async resolveGameName(gameId: number): Promise<string> {
    return (await this.resolveGameInfo(gameId)).gameName;
  }

  private async resolveGameInfo(gameId: number) {
    const [game] = await this.db
      .select({ name: schema.games.name, coverUrl: schema.games.coverUrl })
      .from(schema.games)
      .where(eq(schema.games.id, gameId))
      .limit(1);
    return {
      gameName: game?.name ?? 'Game Night',
      gameCoverUrl: game?.coverUrl ?? null,
    };
  }

  private buildCreateEventDto(
    title: string,
    gameId: number,
    proposedTime: Date | string,
    recurring: boolean,
  ): CreateEventDto {
    const startTime = new Date(proposedTime);
    const endTime = new Date(startTime.getTime() + EVENT_DURATION_MS);
    const base = {
      title,
      gameId,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    };
    if (!recurring) return base;
    const until = new Date(startTime.getTime() + FOUR_WEEKS_MS);
    return {
      ...base,
      recurrence: { frequency: 'weekly' as const, until: until.toISOString() },
    };
  }
}

/**
 * Scheduling poll service (ROK-965).
 * Manages time slot suggestions, voting, and event creation for match groups.
 */
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
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
  findUserSchedulingMatches,
  deleteAllUserVotesForMatch,
} from './scheduling-query.helpers';
import { buildSchedulingAvailability } from './scheduling-availability.helpers';
import {
  findMatchById,
  findMatchMembers,
} from '../lineups-match-query.helpers';
import { buildPollResponse } from './scheduling-response.helpers';

@Injectable()
export class SchedulingService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly eventsService: EventsService,
  ) {}

  /** Get the full scheduling poll page data for a match. */
  async getSchedulePoll(
    matchId: number,
    userId: number | null,
  ): Promise<SchedulePollPageResponseDto> {
    const [match] = await findMatchById(this.db, matchId);
    if (!match) throw new NotFoundException('Match not found');

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
    const enrichedMatch = { ...match, ...gameInfo };

    return buildPollResponse(
      enrichedMatch,
      members,
      slots,
      votes,
      userId,
      lineup?.status ?? 'scheduling',
    );
  }

  /** Suggest a new time slot for a match. */
  async suggestSlot(
    matchId: number,
    proposedTime: string,
  ): Promise<{ id: number }> {
    await this.assertMatchExists(matchId);
    const [slot] = await insertScheduleSlot(
      this.db,
      matchId,
      new Date(proposedTime),
      'user',
    );
    return { id: slot.id };
  }

  /** Toggle a vote on a schedule slot. Returns voted state. */
  async toggleVote(
    slotId: number,
    userId: number,
  ): Promise<{ voted: boolean }> {
    const existing = await findVoteBySlotAndUser(this.db, slotId, userId);
    if (existing.length > 0) {
      await deleteScheduleVote(this.db, slotId, userId);
      return { voted: false };
    }
    await insertScheduleVote(this.db, slotId, userId);
    return { voted: true };
  }

  /** Create an event from a schedule slot. */
  async createEventFromSlot(
    matchId: number,
    slotId: number,
    userId: number,
    recurring: boolean = false,
  ): Promise<{ eventId: number }> {
    const [match] = await findMatchById(this.db, matchId);
    if (!match) throw new NotFoundException('Match not found');
    if (match.linkedEventId) {
      throw new BadRequestException('Event already created for this match');
    }

    const slot = await this.findSlotById(slotId);
    if (!slot) throw new NotFoundException('Slot not found');

    const gameName = await this.resolveGameName(match.gameId);
    const dto = this.buildCreateEventDto(
      gameName, match.gameId, slot.proposedTime, recurring,
    );

    const event = await this.eventsService.create(userId, dto);
    await updateMatchLinkedEvent(this.db, matchId, event.id);
    return { eventId: event.id };
  }

  /** Retract all votes by a user for slots belonging to a match. */
  async retractAllVotes(
    matchId: number,
    userId: number,
  ): Promise<void> {
    await deleteAllUserVotesForMatch(this.db, matchId, userId);
  }

  /** Get heatmap availability data for a match's members. */
  async getMatchAvailability(
    matchId: number,
  ): Promise<AggregateGameTimeResponse> {
    const members = await findMatchMembers(this.db, [matchId]);
    const userIds = members.map((m) => m.userId);
    return buildSchedulingAvailability(this.db, userIds, matchId);
  }

  /** Get the scheduling banner for the events page. */
  async getSchedulingBanner(
    userId: number,
  ): Promise<SchedulingBannerDto | null> {
    return this.buildBannerForUser(userId);
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

  /** Assert that a match exists. */
  private async assertMatchExists(matchId: number): Promise<void> {
    const [match] = await findMatchById(this.db, matchId);
    if (!match) throw new NotFoundException('Match not found');
  }

  /** Find a schedule slot by ID. */
  private async findSlotById(slotId: number) {
    const [slot] = await this.db
      .select()
      .from(schema.communityLineupScheduleSlots)
      .where(eq(schema.communityLineupScheduleSlots.id, slotId))
      .limit(1);
    return slot ?? null;
  }

  /** Build CreateEventDto, optionally with weekly recurrence. */
  private buildCreateEventDto(
    title: string,
    gameId: number,
    proposedTime: Date | string,
    recurring: boolean,
  ): CreateEventDto {
    const startTime = new Date(proposedTime);
    const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000);
    const base = {
      title,
      gameId,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    };
    if (!recurring) return base;
    const FOUR_WEEKS_MS = 4 * 7 * 24 * 60 * 60 * 1000;
    const until = new Date(startTime.getTime() + FOUR_WEEKS_MS);
    return {
      ...base,
      recurrence: { frequency: 'weekly' as const, until: until.toISOString() },
    };
  }

  /** Resolve game name from game ID. */
  private async resolveGameName(gameId: number): Promise<string> {
    const info = await this.resolveGameInfo(gameId);
    return info.gameName;
  }

  /** Resolve game name and cover URL from game ID. */
  private async resolveGameInfo(
    gameId: number,
  ): Promise<{ gameName: string; gameCoverUrl: string | null }> {
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

  /** Build the scheduling banner for a user. */
  private async buildBannerForUser(
    userId: number,
  ): Promise<SchedulingBannerDto | null> {
    const activeLineup = await this.findActiveSchedulingLineup();
    if (!activeLineup) return null;

    const matches = await findUserSchedulingMatches(
      this.db,
      activeLineup.id,
      userId,
    );
    if (matches.length === 0) return null;

    const polls = await Promise.all(
      matches.map(async (m) => {
        const slots = await findScheduleSlots(this.db, m.matchId);
        return {
          matchId: m.matchId,
          gameName: m.gameName,
          gameCoverUrl: m.gameCoverUrl,
          memberCount: m.memberCount,
          slotCount: slots.length,
        };
      }),
    );

    return { lineupId: activeLineup.id, polls };
  }

  /** Find the active lineup in scheduling status. */
  private async findActiveSchedulingLineup() {
    const [lineup] = await this.db
      .select({ id: schema.communityLineups.id })
      .from(schema.communityLineups)
      .where(eq(schema.communityLineups.status, 'scheduling'))
      .limit(1);
    return lineup ?? null;
  }
}

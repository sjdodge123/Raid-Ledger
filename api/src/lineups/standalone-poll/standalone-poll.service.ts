/**
 * Service for standalone scheduling polls (ROK-977).
 * Creates a minimal lineup (decided) + match (scheduling) behind the scenes,
 * exposing a simplified API that skips the full lineup flow.
 */
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { SchedulingPollResponseDto } from '@raid-ledger/contract';
import { eq } from 'drizzle-orm';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { LineupPhaseQueueService } from '../queue/lineup-phase.queue';
import { StandalonePollNotificationService } from './standalone-poll-notification.service';
import { SchedulingPollEmbedService } from '../scheduling/scheduling-poll-embed.service';
import {
  findGameById,
  eventExists,
  filterValidUserIds,
  insertDecidedLineup,
  insertSchedulingMatch,
  insertMatchMembers,
  countMatchMembers,
  findActiveStandalonePolls,
  completeStandalonePoll,
} from './standalone-poll-query.helpers';
import { findScheduleSlots, findScheduleVotes } from '../scheduling/scheduling-query.helpers';
import { autoSignupSlotVoters } from '../scheduling/scheduling-auto-signup.helpers';
import { insertPollInterests } from '../scheduling/scheduling-auto-heart.helpers';
import { SignupsService } from '../../events/signups.service';

/** Input DTO after Zod validation. */
export interface CreatePollInput {
  gameId: number;
  linkedEventId?: number;
  durationHours?: number;
  memberUserIds?: number[];
  /** Minimum unique voters before organizer is notified (ROK-1015). */
  minVoteThreshold?: number;
}

@Injectable()
export class StandalonePollService {
  private readonly logger = new Logger(StandalonePollService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly phaseQueue: LineupPhaseQueueService,
    private readonly notifications: StandalonePollNotificationService,
    private readonly schedulingPollEmbed: SchedulingPollEmbedService,
    private readonly signupsService: SignupsService,
  ) {}

  /** List all active standalone scheduling polls. */
  async listActive() {
    return findActiveStandalonePolls(this.db);
  }

  /** Mark a standalone poll as completed (match → scheduled, lineup → archived).
   *  When eventId is provided, auto-signup slot voters and auto-heart the game (ROK-1031). */
  async complete(matchId: number, eventId?: number): Promise<boolean> {
    const ok = await completeStandalonePoll(this.db, matchId);
    if (ok && eventId) {
      this.fireAutoSignup(matchId, eventId).catch((err: unknown) => {
        this.logger.warn(`Auto-signup failed for match ${matchId}: ${err}`);
      });
    }
    return ok;
  }

  /** Fire-and-forget auto-signup + auto-heart for poll voters (ROK-1031). */
  private async fireAutoSignup(matchId: number, eventId: number): Promise<void> {
    const slots = await findScheduleSlots(this.db, matchId);
    const allVoters = await findScheduleVotes(this.db, slots.map((s) => s.id));
    await autoSignupSlotVoters({
      eventId, creatorId: -1, voters: allVoters,
      signupsService: this.signupsService,
    });
    const match = await this.db
      .select({ gameId: schema.communityLineupMatches.gameId })
      .from(schema.communityLineupMatches)
      .where(eq(schema.communityLineupMatches.id, matchId))
      .limit(1);
    if (match[0]?.gameId) {
      const voterIds = [...new Set(allVoters.map((v) => v.userId))];
      await insertPollInterests({ db: this.db, gameId: match[0].gameId, voterUserIds: voterIds });
    }
  }

  /**
   * Create a standalone scheduling poll.
   * Inserts a decided lineup + scheduling match, adds members,
   * optionally schedules auto-archive, and notifies interested users.
   */
  async create(
    input: CreatePollInput,
    userId: number,
  ): Promise<SchedulingPollResponseDto> {
    const game = await this.validateGame(input.gameId);
    if (input.linkedEventId) {
      await this.validateEvent(input.linkedEventId);
    }
    const phaseDeadline = this.computeDeadline(input.durationHours);
    const lineup = await insertDecidedLineup(
      this.db,
      userId,
      input.linkedEventId,
      phaseDeadline,
    );
    const match = await insertSchedulingMatch(
      this.db,
      lineup.id,
      input.gameId,
      input.linkedEventId,
      input.minVoteThreshold,
    );
    await this.addMembers(match.id, userId, input.memberUserIds);
    if (phaseDeadline) {
      await this.scheduleArchive(lineup.id, phaseDeadline);
    }
    this.fireNotifications(game, lineup.id, match.id, userId);
    this.schedulingPollEmbed.firePostInitialEmbed(
      { id: match.id, gameId: input.gameId },
      lineup.id,
      input.gameId,
    );
    const memberCount = await countMatchMembers(this.db, match.id);
    return this.buildResponse(match.id, lineup.id, game, memberCount);
  }

  /** Validate game exists, throw 404 if not. */
  private async validateGame(
    gameId: number,
  ): Promise<{ id: number; name: string; coverUrl: string | null }> {
    const game = await findGameById(this.db, gameId);
    if (!game) throw new NotFoundException('Game not found');
    return game;
  }

  /** Validate linked event exists, throw 404 if not. */
  private async validateEvent(eventId: number): Promise<void> {
    const exists = await eventExists(this.db, eventId);
    if (!exists) throw new NotFoundException('Event not found');
  }

  /** Compute phase deadline from optional durationHours. */
  private computeDeadline(durationHours?: number): Date | null {
    if (!durationHours) return null;
    return new Date(Date.now() + durationHours * 60 * 60 * 1000);
  }

  /** Add creator + provided members to the match. */
  private async addMembers(
    matchId: number,
    creatorId: number,
    memberUserIds?: number[],
  ): Promise<void> {
    const validIds = memberUserIds?.length
      ? await filterValidUserIds(this.db, memberUserIds)
      : [];
    const allIds = [creatorId, ...validIds];
    await insertMatchMembers(this.db, matchId, allIds);
  }

  /** Schedule decided->archived transition via phase queue. */
  private async scheduleArchive(
    lineupId: number,
    deadline: Date,
  ): Promise<void> {
    const delayMs = deadline.getTime() - Date.now();
    await this.phaseQueue.scheduleTransition(lineupId, 'archived', delayMs);
  }

  /** Fire-and-forget: notify game-interested users. */
  private fireNotifications(
    game: { id: number; name: string; coverUrl: string | null },
    lineupId: number,
    matchId: number,
    creatorId: number,
  ): void {
    void this.notifications.notifyInterestedUsers(
      game.id,
      game.name,
      lineupId,
      matchId,
      creatorId,
      game.coverUrl,
    );
  }

  /** Build the API response DTO. */
  private buildResponse(
    matchId: number,
    lineupId: number,
    game: { id: number; name: string; coverUrl: string | null },
    memberCount: number,
  ): SchedulingPollResponseDto {
    return {
      id: matchId,
      lineupId,
      gameId: game.id,
      gameName: game.name,
      gameCoverUrl: game.coverUrl,
      memberCount,
      status: 'scheduling',
      createdAt: new Date().toISOString(),
    };
  }
}

/**
 * Service for standalone scheduling polls (ROK-977).
 * Creates a minimal lineup (decided) + match (scheduling) behind the scenes,
 * exposing a simplified API that skips the full lineup flow.
 */
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  forwardRef,
} from '@nestjs/common';
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
  filterValidUserIds,
  insertDecidedLineup,
  insertSchedulingMatch,
  insertMatchMembers,
  countMatchMembers,
  findActiveStandalonePolls,
  completeStandalonePoll,
  stampReschedulingPollId,
} from './standalone-poll-query.helpers';
import {
  assertCanRescheduleEvent,
  assertCanCompletePoll,
} from './standalone-poll-auth.helpers';
import {
  findScheduleSlots,
  findScheduleVotes,
} from '../scheduling/scheduling-query.helpers';
import { autoSignupSlotVoters } from '../scheduling/scheduling-auto-signup.helpers';
import { insertPollInterests } from '../scheduling/scheduling-auto-heart.helpers';
import { SignupsService } from '../../events/signups.service';
import { EventsService } from '../../events/events.service';
import { APP_EVENT_EVENTS } from '../../discord-bot/discord-bot.constants';
import {
  splitVotersBySlot,
  notifyPollVoters,
} from './standalone-poll-voter.helpers';
import { SettingsService } from '../../settings/settings.service';
import { EmbedSyncQueueService } from '../../discord-bot/queues/embed-sync.queue';

/** No-op rejection swallower for fire-and-forget DMs. */
const noop = (): void => {};

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
    private readonly settingsService: SettingsService,
    private readonly eventsService: EventsService,
    @Inject(forwardRef(() => EmbedSyncQueueService))
    private readonly embedSyncQueue: EmbedSyncQueueService,
  ) {}

  /** List all active standalone scheduling polls. */
  async listActive() {
    return findActiveStandalonePolls(this.db);
  }

  /** Mark a standalone poll as completed (match -> scheduled, lineup -> archived).
   *  When eventId is provided, auto-signup slot voters and auto-heart the game (ROK-1031). */
  async complete(
    matchId: number,
    eventId?: number,
    startTime?: string,
    creatorId?: number,
    isAdmin = false,
  ): Promise<boolean> {
    // ROK-1370 (P2): a LINKED poll's lock-in re-emits UPDATED (embed → POSTED,
    // SE recreated) — restrict it to the poll/event owner or an admin.
    await assertCanCompletePoll(this.db, matchId, creatorId ?? -1, isAdmin);
    const result = await completeStandalonePoll(this.db, matchId);
    if (result.ok && eventId) {
      this.fireAutoSignup(matchId, eventId, startTime, creatorId).catch(
        (err) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(`Auto-signup failed for match ${matchId}: ${msg}`);
        },
      );
    }
    // ROK-1370: lock-in cleared reschedulingPollId — re-emit UPDATED so the
    // embed resets RESCHEDULING → POSTED and the Scheduled Event is recreated
    // at the (already-moved) winning time. Skip for an event cancelled
    // mid-poll: the re-emit would recreate a Discord SE for a dead event.
    if (result.ok && result.linkedEventId && !result.linkedEventCancelled) {
      this.eventsService
        .emitLifecycleEvent(result.linkedEventId, APP_EVENT_EVENTS.UPDATED)
        .catch(noop);
      // ROK-1392: the UPDATED re-emit recreates the Scheduled Event, but its
      // embed re-render is fire-and-forget — on a quiet server nothing else
      // enqueues an embed sync, so the card can stay stuck on RESCHEDULING
      // until unrelated traffic heals it. completeStandalonePoll has already
      // cleared reschedulingPollId, so enqueue an explicit level-triggered
      // sync now: the processor reads the (cleared) flag and restores the live
      // embed deterministically. Symmetric to the poll-start RESCHEDULING
      // teardown's updateEmbedState.
      await this.embedSyncQueue.enqueue(
        result.linkedEventId,
        'reschedule-poll-lockin',
      );
    }
    return result.ok;
  }

  /** Fire-and-forget auto-signup + auto-heart for poll voters (ROK-1031). */
  private async fireAutoSignup(
    matchId: number,
    eventId: number,
    startTime?: string,
    creatorId?: number,
  ): Promise<void> {
    const slots = await findScheduleSlots(this.db, matchId);
    const allVoters = await findScheduleVotes(
      this.db,
      slots.map((s) => s.id),
    );
    const { selectedVoters, otherVoters } = splitVotersBySlot(
      slots,
      allVoters,
      startTime,
    );
    await autoSignupSlotVoters({
      eventId,
      creatorId: creatorId ?? -1,
      voters: selectedVoters,
      signupsService: this.signupsService,
    });
    const [match] = await this.db
      .select({
        gameId: schema.communityLineupMatches.gameId,
        gameName: schema.games.name,
      })
      .from(schema.communityLineupMatches)
      .innerJoin(
        schema.games,
        eq(schema.games.id, schema.communityLineupMatches.gameId),
      )
      .where(eq(schema.communityLineupMatches.id, matchId))
      .limit(1);
    if (match?.gameId) {
      const allVoterIds = [...new Set(allVoters.map((v) => v.userId))];
      await insertPollInterests({
        db: this.db,
        gameId: match.gameId,
        voterUserIds: allVoterIds,
      });
    }
    if (startTime) {
      await notifyPollVoters(
        {
          db: this.db,
          settingsService: this.settingsService,
          notifications: this.notifications,
        },
        selectedVoters,
        otherVoters,
        startTime,
        eventId,
        match?.gameName ?? 'Game Night',
      );
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
    isAdmin = false,
  ): Promise<SchedulingPollResponseDto> {
    const game = await this.validateGame(input.gameId);
    if (input.linkedEventId) {
      // ROK-1370 (P1): opening a poll linked to an event is destructive — only
      // the event owner or an admin may do it (404 preserved when missing).
      await assertCanRescheduleEvent(
        this.db,
        input.linkedEventId,
        userId,
        isAdmin,
      );
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
    if (input.linkedEventId) {
      await this.linkEventToPoll(input.linkedEventId, match.id);
    }
    await this.addMembers(match.id, userId, input.memberUserIds);
    if (phaseDeadline) {
      await this.scheduleArchive(lineup.id, phaseDeadline);
    }
    this.fireNotifications(
      game,
      lineup.id,
      match.id,
      userId,
      input.linkedEventId,
    );
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

  /** Atomically set reschedulingPollId on the linked event. */
  private async linkEventToPoll(
    eventId: number,
    matchId: number,
  ): Promise<void> {
    const stamped = await stampReschedulingPollId(this.db, eventId, matchId);
    if (!stamped) {
      throw new ConflictException(
        'Event is already being rescheduled or has been cancelled.',
      );
    }
    // ROK-1370 (Option A): flip the Discord embed to RESCHEDULING and tear down
    // the Scheduled Event now — lock-in recreates it at the winning time.
    this.eventsService
      .emitLifecycleEvent(eventId, APP_EVENT_EVENTS.RESCHEDULING)
      .catch(noop);
  }

  /** Fire-and-forget: notify game-interested users. */
  private fireNotifications(
    game: { id: number; name: string; coverUrl: string | null },
    lineupId: number,
    matchId: number,
    creatorId: number,
    linkedEventId?: number,
  ): void {
    void this.notifications.notifyInterestedUsers(
      game.id,
      game.name,
      lineupId,
      matchId,
      creatorId,
      game.coverUrl,
      linkedEventId,
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

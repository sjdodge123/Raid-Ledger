import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { eq, inArray } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import {
  CreateEventPlanDto,
  EventPlanResponseDto,
  TimeSuggestionsResponse,
  PollResultsResponse,
  ConvertEventToPlanDto,
} from '@raid-ledger/contract';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { ChannelResolverService } from '../discord-bot/services/channel-resolver.service';
import { SettingsService } from '../settings/settings.service';
import { EventsService } from './events.service';
import { SignupsService } from './signups.service';
import {
  type PollAnswerResult,
  determineWinner,
  mapToConcreteDates,
  generateFallbackSuggestions,
  toResponseDto,
} from './event-plans-poll.helpers';
import {
  postDiscordPoll,
  fetchPollResults,
  lookupGameInfo,
  dmOrganizer,
} from './event-plans-discord.helpers';
import {
  handleStandardNoneWins,
  shouldRepollAllOrNothing,
  handleNoWinner,
  buildPollResultsResponse,
} from './event-plans-lifecycle.helpers';

export const EVENT_PLANS_QUEUE = 'event-plans';

export interface PollClosedJobData {
  planId: string;
}

export type { PollAnswerResult };

@Injectable()
export class EventPlansService {
  private readonly logger = new Logger(EventPlansService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    @InjectQueue(EVENT_PLANS_QUEUE) private queue: Queue,
    private readonly discordClient: DiscordBotClientService,
    private readonly channelResolver: ChannelResolverService,
    private readonly settingsService: SettingsService,
    private readonly eventsService: EventsService,
    private readonly signupsService: SignupsService,
  ) {}

  async create(
    creatorId: number,
    dto: CreateEventPlanDto,
  ): Promise<EventPlanResponseDto> {
    this.assertDiscordConnected();
    const channelId = await this.resolveChannelOrThrow(dto.gameId);
    const plan = await this.insertPlan(creatorId, dto, channelId);
    const { gameName, gameCoverUrl } = await lookupGameInfo(
      this.db,
      dto.gameId ?? null,
    );

    try {
      const messageId = await this.postPoll(
        channelId,
        plan,
        dto.title,
        dto.pollOptions,
        dto.pollDurationHours,
        1,
        {
          description: dto.description,
          gameName,
          gameCoverUrl,
          durationMinutes: dto.durationMinutes,
          slotConfig: dto.slotConfig as Record<string, unknown> | null,
          pollMode: dto.pollMode,
        },
      );
      await this.db
        .update(schema.eventPlans)
        .set({ pollMessageId: messageId })
        .where(eq(schema.eventPlans.id, plan.id));
      plan.pollMessageId = messageId;
    } catch (error) {
      await this.db
        .update(schema.eventPlans)
        .set({ status: 'draft' })
        .where(eq(schema.eventPlans.id, plan.id));
      this.logger.error('Failed to post Discord poll:', error);
      throw new BadRequestException(
        'Failed to post Discord poll. The bot may not have Send Polls permission.',
      );
    }

    await this.schedulePollClose(plan.id, dto.pollDurationHours * 3600 * 1000);
    this.logger.log(
      `Event plan ${plan.id} created, poll posted to channel ${channelId}`,
    );
    return toResponseDto(plan);
  }

  async convertFromEvent(
    eventId: number,
    userId: number,
    userRole?: string,
    options?: ConvertEventToPlanDto,
  ): Promise<EventPlanResponseDto> {
    const event = await this.eventsService.findOne(eventId);
    const isPrivileged = userRole === 'admin' || userRole === 'operator';
    if (event.creator.id !== userId && !isPrivileged) {
      throw new ForbiddenException(
        'Only the event creator or an admin/operator can convert this event to a plan',
      );
    }

    const durationMinutes = Math.max(
      1,
      Math.round(
        (Date.parse(event.endTime) - Date.parse(event.startTime)) / 60000,
      ),
    );
    const channelId = await this.resolveChannelOrThrow(event.game?.id ?? null);
    const suggestions = await this.getTimeSuggestions(
      event.game?.id ?? undefined,
      0,
    );
    const pollOptions = suggestions.suggestions
      .slice(0, 9)
      .map((s) => ({ date: s.date, label: s.label }));
    if (pollOptions.length < 2) {
      throw new BadRequestException(
        'Could not generate enough time suggestions. At least 2 options are required.',
      );
    }

    const pollDurationHours = options?.pollDurationHours ?? 24;
    const plan = await this.insertConvertedPlan(
      userId,
      event,
      durationMinutes,
      pollOptions,
      pollDurationHours,
      channelId,
    );

    try {
      const messageId = await this.postPoll(
        channelId,
        plan,
        event.title,
        pollOptions,
        pollDurationHours,
        1,
        {
          description: event.description,
          gameName: event.game?.name ?? null,
          gameCoverUrl: event.game?.coverUrl ?? null,
          durationMinutes,
          slotConfig: event.slotConfig as Record<string, unknown> | null,
          pollMode: 'standard',
        },
      );
      await this.db
        .update(schema.eventPlans)
        .set({ pollMessageId: messageId })
        .where(eq(schema.eventPlans.id, plan.id));
      plan.pollMessageId = messageId;
    } catch (error) {
      await this.db
        .update(schema.eventPlans)
        .set({ status: 'draft' })
        .where(eq(schema.eventPlans.id, plan.id));
      this.logger.error(
        'Failed to post Discord poll for event conversion:',
        error,
      );
      throw new BadRequestException(
        'Failed to post Discord poll. The bot may not have Send Polls permission.',
      );
    }

    await this.schedulePollClose(plan.id, pollDurationHours * 3600 * 1000);

    if (options?.cancelOriginal !== false) {
      try {
        await this.eventsService.cancel(eventId, userId, isPrivileged, {
          reason: 'Converted to community poll',
        });
      } catch (error) {
        this.logger.warn(
          `Failed to cancel original event ${eventId} during conversion:`,
          error,
        );
      }
    }

    this.logger.log(
      `Event ${eventId} converted to plan ${plan.id} by user ${userId}`,
    );
    return toResponseDto(plan);
  }

  async findOne(planId: string): Promise<EventPlanResponseDto> {
    const plan = await this.findPlanOrThrow(planId);
    return toResponseDto(plan);
  }

  async findAll(): Promise<EventPlanResponseDto[]> {
    const plans = await this.db
      .select()
      .from(schema.eventPlans)
      .orderBy(schema.eventPlans.createdAt);
    return plans.map((p) => toResponseDto(p));
  }

  async cancel(
    planId: string,
    userId: number,
    userRole?: string,
  ): Promise<EventPlanResponseDto> {
    const plan = await this.findPlanOrThrow(planId);
    this.assertCreatorOrPrivileged(plan, userId, userRole, 'cancel it');
    if (plan.status !== 'polling') {
      throw new BadRequestException(
        `Cannot cancel a plan with status "${plan.status}"`,
      );
    }

    await this.tryDeletePollMessage(plan);
    await this.tryRemovePollJob(planId);

    const [updated] = await this.db
      .update(schema.eventPlans)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(schema.eventPlans.id, planId))
      .returning();

    this.safeDmOrganizer(
      plan.creatorId,
      `Your event plan "${plan.title}" has been cancelled.`,
    );
    this.logger.log(`Event plan ${planId} cancelled by user ${userId}`);
    return toResponseDto(updated);
  }

  async getPollResults(
    planId: string,
    userId: number,
    userRole?: string,
  ): Promise<PollResultsResponse> {
    const plan = await this.findPlanOrThrow(planId);
    this.assertCreatorOrPrivileged(plan, userId, userRole, 'view poll results');

    if (plan.status !== 'polling') {
      return {
        planId: plan.id,
        status: plan.status as PollResultsResponse['status'],
        pollOptions: [],
        noneOption: null,
        totalRegisteredVoters: 0,
        pollEndsAt: plan.pollEndsAt?.toISOString() ?? null,
      };
    }

    let rawResults: Map<number, PollAnswerResult>;
    try {
      rawResults = await fetchPollResults(
        this.db,
        this.discordClient,
        plan.pollChannelId!,
        plan.pollMessageId!,
      );
    } catch (error) {
      this.logger.error(
        `Failed to fetch poll results for plan ${planId}:`,
        error,
      );
      throw new ServiceUnavailableException(
        'Could not fetch poll results from Discord. The bot may be offline.',
      );
    }

    const built = await buildPollResultsResponse(
      this.db,
      this.discordClient,
      plan,
      rawResults,
    );
    return {
      planId: plan.id,
      status: plan.status as PollResultsResponse['status'],
      ...built,
      pollEndsAt: plan.pollEndsAt?.toISOString() ?? null,
    };
  }

  async restart(
    planId: string,
    userId: number,
    userRole?: string,
  ): Promise<EventPlanResponseDto> {
    const plan = await this.findPlanOrThrow(planId);
    this.assertCreatorOrPrivileged(plan, userId, userRole, 'restart it');
    if (
      plan.status !== 'cancelled' &&
      plan.status !== 'expired' &&
      plan.status !== 'draft'
    ) {
      throw new BadRequestException(
        `Can only restart plans with status "cancelled", "expired", or "draft", got "${plan.status}"`,
      );
    }

    const { gameName, gameCoverUrl } = await lookupGameInfo(
      this.db,
      plan.gameId,
    );
    const pollOptions = this.regenerateLabels(
      plan.pollOptions as Array<{ date: string; label: string }>,
    );
    const newRound = plan.status === 'draft' ? 1 : (plan.pollRound ?? 1) + 1;
    const channelId =
      plan.pollChannelId ??
      (await this.channelResolver.resolveChannelForEvent(plan.gameId));
    if (!channelId) {
      throw new BadRequestException(
        'No Discord channel configured for this game.',
      );
    }

    let messageId: string;
    try {
      messageId = await this.postPoll(
        channelId,
        plan,
        plan.title,
        pollOptions,
        plan.pollDurationHours,
        newRound,
        {
          description: plan.description,
          gameName,
          gameCoverUrl,
          durationMinutes: plan.durationMinutes,
          slotConfig: plan.slotConfig as Record<string, unknown> | null,
          pollMode: plan.pollMode,
        },
      );
    } catch (error) {
      this.logger.error(
        `Failed to post Discord poll for restart of plan ${planId}:`,
        error,
      );
      throw new BadRequestException(
        'Failed to post Discord poll. The bot may not have Send Polls permission.',
      );
    }

    const pollEndsAt = new Date(
      Date.now() + plan.pollDurationHours * 3600 * 1000,
    );
    const [updated] = await this.db
      .update(schema.eventPlans)
      .set({
        status: 'polling',
        pollChannelId: channelId,
        pollMessageId: messageId,
        pollRound: newRound,
        pollStartedAt: new Date(),
        pollEndsAt,
        updatedAt: new Date(),
      })
      .where(eq(schema.eventPlans.id, planId))
      .returning();

    await this.schedulePollClose(plan.id, plan.pollDurationHours * 3600 * 1000);
    this.logger.log(
      `Event plan ${planId} restarted (round ${newRound}) by user ${userId}`,
    );
    return toResponseDto(updated);
  }

  async processPollClose(planId: string): Promise<void> {
    const [plan] = await this.db
      .select()
      .from(schema.eventPlans)
      .where(eq(schema.eventPlans.id, planId))
      .limit(1);
    if (!plan || plan.status !== 'polling') {
      this.logger.warn(
        `Plan ${planId} not found or not in polling status, skipping`,
      );
      return;
    }

    let results: Map<number, PollAnswerResult>;
    try {
      results = await fetchPollResults(
        this.db,
        this.discordClient,
        plan.pollChannelId!,
        plan.pollMessageId!,
      );
    } catch (error) {
      this.logger.error(
        `Failed to fetch poll results for plan ${planId}:`,
        error,
      );
      await this.db
        .update(schema.eventPlans)
        .set({ status: 'expired', updatedAt: new Date() })
        .where(eq(schema.eventPlans.id, planId));
      return;
    }

    const pollOptions = plan.pollOptions as Array<{
      date: string;
      label: string;
    }>;
    const noneIndex = pollOptions.length;

    if (
      plan.pollMode === 'all_or_nothing' &&
      shouldRepollAllOrNothing(plan, results, noneIndex, pollOptions.length)
    ) {
      await this.handleRepoll(plan);
      return;
    }

    if (plan.pollMode === 'standard') {
      const stopped = await handleStandardNoneWins(
        this.db,
        this.discordClient,
        plan,
        results,
        noneIndex,
      );
      if (stopped) return;
    }

    const winnerIndex = determineWinner(results, pollOptions, noneIndex);
    if (winnerIndex === null) {
      await handleNoWinner(this.db, this.discordClient, plan);
      return;
    }

    await this.createEventFromPlan(plan, winnerIndex);
  }

  async getTimeSuggestions(
    gameId?: number,
    tzOffset?: number,
    afterDate?: string,
  ): Promise<TimeSuggestionsResponse> {
    const offset = tzOffset ?? 0;
    const after = afterDate ? new Date(afterDate) : new Date();
    const timezone =
      (await this.settingsService.getDefaultTimezone()) ?? undefined;

    if (gameId) {
      const interests = await this.db
        .select({ userId: schema.gameInterests.userId })
        .from(schema.gameInterests)
        .where(eq(schema.gameInterests.gameId, gameId));
      const userIds = interests.map((i) => i.userId);
      if (userIds.length > 0) {
        const templates = await this.db
          .select({
            dayOfWeek: schema.gameTimeTemplates.dayOfWeek,
            startHour: schema.gameTimeTemplates.startHour,
          })
          .from(schema.gameTimeTemplates)
          .where(inArray(schema.gameTimeTemplates.userId, userIds));

        if (templates.length > 0) {
          const countMap = new Map<string, number>();
          for (const t of templates) {
            const key = `${t.dayOfWeek}:${t.startHour}`;
            countMap.set(key, (countMap.get(key) ?? 0) + 1);
          }
          const ranked = Array.from(countMap.entries())
            .sort(([, a], [, b]) => b - a)
            .slice(0, 21);
          const suggestions = mapToConcreteDates(
            ranked,
            offset,
            after,
            14,
            timezone,
          );
          return {
            source: 'game-interest',
            interestedPlayerCount: userIds.length,
            suggestions: suggestions.slice(0, 20),
          };
        }
      }
    }

    return {
      source: 'fallback',
      interestedPlayerCount: 0,
      suggestions: generateFallbackSuggestions(offset, after, timezone),
    };
  }

  // ── Private helpers ──────────────────────────────────────────

  private assertDiscordConnected(): void {
    if (!this.discordClient.isConnected()) {
      throw new ServiceUnavailableException(
        'The Discord bot is not connected. Event plans require Discord to post a poll.',
      );
    }
  }

  private async resolveChannelOrThrow(
    gameId: number | null | undefined,
  ): Promise<string> {
    const channelId = await this.channelResolver.resolveChannelForEvent(
      gameId ?? null,
    );
    if (!channelId) {
      throw new BadRequestException(
        'No Discord channel configured for this game. Set a default channel or bind a channel first.',
      );
    }
    return channelId;
  }

  private async findPlanOrThrow(planId: string) {
    const [plan] = await this.db
      .select()
      .from(schema.eventPlans)
      .where(eq(schema.eventPlans.id, planId))
      .limit(1);
    if (!plan) throw new NotFoundException(`Event plan ${planId} not found`);
    return plan;
  }

  private assertCreatorOrPrivileged(
    plan: { creatorId: number },
    userId: number,
    userRole: string | undefined,
    action: string,
  ): void {
    const isPrivileged = userRole === 'admin' || userRole === 'operator';
    if (plan.creatorId !== userId && !isPrivileged) {
      throw new ForbiddenException(
        `Only the plan creator or an admin/operator can ${action}`,
      );
    }
  }

  private async postPoll(
    channelId: string,
    plan: { id: string },
    title: string,
    options: Array<{ date: string; label: string }>,
    durationHours: number,
    round: number,
    details?: {
      description?: string | null;
      gameName?: string | null;
      gameCoverUrl?: string | null;
      durationMinutes?: number;
      slotConfig?: Record<string, unknown> | null;
      pollMode?: string;
    },
  ): Promise<string> {
    return postDiscordPoll(this.discordClient, {
      channelId,
      planId: plan.id,
      title,
      options,
      durationHours,
      round,
      details,
    });
  }

  private async schedulePollClose(
    planId: string,
    delayMs: number,
  ): Promise<void> {
    await this.queue.add(
      'poll-closed',
      { planId } satisfies PollClosedJobData,
      {
        jobId: `plan-poll-close-${planId}`,
        delay: delayMs,
        removeOnComplete: true,
        removeOnFail: 50,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );
  }

  private async tryDeletePollMessage(
    plan: typeof schema.eventPlans.$inferSelect,
  ): Promise<void> {
    if (!plan.pollChannelId || !plan.pollMessageId) return;
    try {
      await this.discordClient.deleteMessage(
        plan.pollChannelId,
        plan.pollMessageId,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to delete poll message for plan ${plan.id}:`,
        error,
      );
    }
  }

  private async tryRemovePollJob(planId: string): Promise<void> {
    const job = await this.queue.getJob(`plan-poll-close-${planId}`);
    if (job) await job.remove();
  }

  private safeDmOrganizer(userId: number, message: string): void {
    dmOrganizer(this.db, this.discordClient, userId, message).catch((e) =>
      this.logger.warn(
        `Failed to DM organizer ${userId}:`,
        e instanceof Error ? e.message : 'Unknown error',
      ),
    );
  }

  private regenerateLabels(
    options: Array<{ date: string; label: string }>,
  ): Array<{ date: string; label: string }> {
    return options.map((opt) => ({
      date: opt.date,
      label: new Date(opt.date).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZoneName: 'short',
      }),
    }));
  }

  private async insertPlan(
    creatorId: number,
    dto: CreateEventPlanDto,
    channelId: string,
  ) {
    const [plan] = await this.db
      .insert(schema.eventPlans)
      .values({
        creatorId,
        title: dto.title,
        description: dto.description ?? null,
        gameId: dto.gameId ?? null,
        slotConfig: dto.slotConfig ?? null,
        maxAttendees: dto.maxAttendees ?? null,
        autoUnbench: dto.autoUnbench ?? true,
        durationMinutes: dto.durationMinutes,
        pollOptions: dto.pollOptions,
        pollDurationHours: dto.pollDurationHours,
        pollMode: dto.pollMode ?? 'standard',
        pollChannelId: channelId,
        status: 'polling',
        contentInstances: dto.contentInstances ?? null,
        reminder15min: dto.reminder15min ?? true,
        reminder1hour: dto.reminder1hour ?? false,
        reminder24hour: dto.reminder24hour ?? false,
        pollStartedAt: new Date(),
        pollEndsAt: new Date(Date.now() + dto.pollDurationHours * 3600 * 1000),
      })
      .returning();
    return plan;
  }

  private async insertConvertedPlan(
    userId: number,
    event: Awaited<ReturnType<EventsService['findOne']>>,
    durationMinutes: number,
    pollOptions: Array<{ date: string; label: string }>,
    pollDurationHours: number,
    channelId: string,
  ) {
    const [plan] = await this.db
      .insert(schema.eventPlans)
      .values({
        creatorId: userId,
        title: event.title,
        description: event.description ?? null,
        gameId: event.game?.id ?? null,
        slotConfig: event.slotConfig ?? null,
        maxAttendees: event.maxAttendees ?? null,
        autoUnbench: event.autoUnbench ?? true,
        durationMinutes,
        pollOptions,
        pollDurationHours,
        pollMode: 'standard',
        pollChannelId: channelId,
        status: 'polling',
        contentInstances: event.contentInstances ?? null,
        reminder15min: event.reminder15min,
        reminder1hour: event.reminder1hour,
        reminder24hour: event.reminder24hour,
        pollStartedAt: new Date(),
        pollEndsAt: new Date(Date.now() + pollDurationHours * 3600 * 1000),
      })
      .returning();
    return plan;
  }

  private async handleRepoll(
    plan: typeof schema.eventPlans.$inferSelect,
  ): Promise<void> {
    const pollOptions = plan.pollOptions as Array<{
      date: string;
      label: string;
    }>;
    const latestDate = pollOptions.reduce((max, opt) => {
      const d = new Date(opt.date).getTime();
      return d > max ? d : max;
    }, 0);
    const afterDate = new Date(latestDate + 24 * 3600 * 1000);
    const suggestions = await this.getTimeSuggestions(
      plan.gameId ?? undefined,
      0,
      afterDate.toISOString(),
    );

    if (suggestions.suggestions.length < 2) {
      await this.db
        .update(schema.eventPlans)
        .set({ status: 'expired', updatedAt: new Date() })
        .where(eq(schema.eventPlans.id, plan.id));
      this.safeDmOrganizer(
        plan.creatorId,
        `The poll for "${plan.title}" couldn't generate enough new time options. The plan has expired.`,
      );
      return;
    }

    const newOptions = suggestions.suggestions
      .slice(0, 9)
      .map((s) => ({ date: s.date, label: s.label }));
    await this.tryDeletePollMessage(plan);
    const newRound = (plan.pollRound ?? 1) + 1;
    const { gameName, gameCoverUrl } = await lookupGameInfo(
      this.db,
      plan.gameId,
    );

    let newMessageId: string;
    try {
      newMessageId = await this.postPoll(
        plan.pollChannelId!,
        plan,
        plan.title,
        newOptions,
        plan.pollDurationHours,
        newRound,
        {
          description: plan.description,
          gameName,
          gameCoverUrl,
          durationMinutes: plan.durationMinutes,
          slotConfig: plan.slotConfig as Record<string, unknown> | null,
          pollMode: plan.pollMode,
        },
      );
    } catch (error) {
      this.logger.error(`Failed to post re-poll for plan ${plan.id}:`, error);
      await this.db
        .update(schema.eventPlans)
        .set({ status: 'expired', updatedAt: new Date() })
        .where(eq(schema.eventPlans.id, plan.id));
      return;
    }

    const pollEndsAt = new Date(
      Date.now() + plan.pollDurationHours * 3600 * 1000,
    );
    await this.db
      .update(schema.eventPlans)
      .set({
        pollOptions: newOptions,
        pollMessageId: newMessageId,
        pollRound: newRound,
        pollStartedAt: new Date(),
        pollEndsAt,
        updatedAt: new Date(),
      })
      .where(eq(schema.eventPlans.id, plan.id));
    await this.schedulePollClose(plan.id, plan.pollDurationHours * 3600 * 1000);
    this.logger.log(`Re-poll posted for plan ${plan.id}, round ${newRound}`);
  }

  private async createEventFromPlan(
    plan: typeof schema.eventPlans.$inferSelect,
    winnerIndex: number,
  ): Promise<void> {
    const pollOptions = plan.pollOptions as Array<{
      date: string;
      label: string;
    }>;
    const winningOption = pollOptions[winnerIndex];
    const startTime = new Date(winningOption.date);
    const endTime = new Date(
      startTime.getTime() + plan.durationMinutes * 60 * 1000,
    );

    try {
      const event = await this.eventsService.create(plan.creatorId, {
        title: plan.title,
        description: plan.description ?? undefined,
        gameId: plan.gameId ?? undefined,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        slotConfig: plan.slotConfig as
          | {
              type: 'mmo' | 'generic';
              tank?: number;
              healer?: number;
              dps?: number;
              flex?: number;
              player?: number;
              bench?: number;
            }
          | undefined,
        maxAttendees: plan.maxAttendees ?? undefined,
        autoUnbench: plan.autoUnbench,
        contentInstances: plan.contentInstances
          ? (plan.contentInstances as Record<string, unknown>[])
          : undefined,
        reminder15min: plan.reminder15min,
        reminder1hour: plan.reminder1hour,
        reminder24hour: plan.reminder24hour,
      });

      await this.signupsService.signup(event.id, plan.creatorId);
      await this.db
        .update(schema.eventPlans)
        .set({
          status: 'completed',
          winningOption: winnerIndex,
          createdEventId: event.id,
          updatedAt: new Date(),
        })
        .where(eq(schema.eventPlans.id, plan.id));

      this.safeDmOrganizer(
        plan.creatorId,
        `The poll for "${plan.title}" has closed! "${winningOption.label}" won. Your event has been auto-created.`,
      );
      this.logger.log(
        `Event ${event.id} created from plan ${plan.id} (winner: option ${winnerIndex})`,
      );
    } catch (error) {
      this.logger.error(`Failed to create event from plan ${plan.id}:`, error);
      await this.db
        .update(schema.eventPlans)
        .set({ status: 'expired', updatedAt: new Date() })
        .where(eq(schema.eventPlans.id, plan.id));
    }
  }
}

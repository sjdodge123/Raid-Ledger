import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
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
  TimeSuggestion,
} from '@raid-ledger/contract';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { ChannelResolverService } from '../discord-bot/services/channel-resolver.service';
import { EventsService } from './events.service';
import { SignupsService } from './signups.service';

export const EVENT_PLANS_QUEUE = 'event-plans';

export interface PollClosedJobData {
  planId: string;
}

@Injectable()
export class EventPlansService {
  private readonly logger = new Logger(EventPlansService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    @InjectQueue(EVENT_PLANS_QUEUE) private queue: Queue,
    private readonly discordClient: DiscordBotClientService,
    private readonly channelResolver: ChannelResolverService,
    private readonly eventsService: EventsService,
    private readonly signupsService: SignupsService,
  ) {}

  /**
   * Create a new event plan and post the Discord poll.
   */
  async create(
    creatorId: number,
    dto: CreateEventPlanDto,
  ): Promise<EventPlanResponseDto> {
    // Resolve the channel for the poll
    const channelId = await this.channelResolver.resolveChannelForEvent(
      dto.gameId,
    );

    if (!channelId) {
      throw new BadRequestException(
        'No Discord channel configured for this game. Set a default channel or bind a channel first.',
      );
    }

    // Insert the plan record
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
        reminder15min: dto.reminder15min ?? true,
        reminder1hour: dto.reminder1hour ?? false,
        reminder24hour: dto.reminder24hour ?? false,
        pollStartedAt: new Date(),
        pollEndsAt: new Date(Date.now() + dto.pollDurationHours * 3600 * 1000),
      })
      .returning();

    // Post the Discord poll
    try {
      const messageId = await this.postDiscordPoll(
        channelId,
        plan.id,
        dto.title,
        dto.pollOptions,
        dto.pollDurationHours,
        1,
      );

      // Update the plan with the message ID
      await this.db
        .update(schema.eventPlans)
        .set({ pollMessageId: messageId })
        .where(eq(schema.eventPlans.id, plan.id));

      plan.pollMessageId = messageId;
    } catch (error) {
      // Mark as draft if poll posting fails
      await this.db
        .update(schema.eventPlans)
        .set({ status: 'draft' })
        .where(eq(schema.eventPlans.id, plan.id));
      this.logger.error('Failed to post Discord poll:', error);
      throw new BadRequestException(
        'Failed to post Discord poll. The bot may not have Send Polls permission.',
      );
    }

    // Schedule the poll-close job
    const delayMs = dto.pollDurationHours * 3600 * 1000;
    await this.queue.add(
      'poll-closed',
      { planId: plan.id } satisfies PollClosedJobData,
      {
        jobId: `plan-poll-close-${plan.id}`,
        delay: delayMs,
        removeOnComplete: true,
        removeOnFail: 50,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );

    this.logger.log(
      `Event plan ${plan.id} created, poll posted to channel ${channelId}`,
    );

    return this.toResponseDto(plan);
  }

  /**
   * Get a single plan by ID.
   */
  async findOne(planId: string): Promise<EventPlanResponseDto> {
    const [plan] = await this.db
      .select()
      .from(schema.eventPlans)
      .where(eq(schema.eventPlans.id, planId))
      .limit(1);

    if (!plan) {
      throw new NotFoundException(`Event plan ${planId} not found`);
    }

    return this.toResponseDto(plan);
  }

  /**
   * List plans for a user. Returns all non-draft plans, most recent first.
   */
  async findByCreator(creatorId: number): Promise<EventPlanResponseDto[]> {
    const plans = await this.db
      .select()
      .from(schema.eventPlans)
      .where(eq(schema.eventPlans.creatorId, creatorId))
      .orderBy(schema.eventPlans.createdAt);

    return plans.map((p) => this.toResponseDto(p));
  }

  /**
   * Cancel an active plan.
   */
  async cancel(planId: string, userId: number): Promise<EventPlanResponseDto> {
    const [plan] = await this.db
      .select()
      .from(schema.eventPlans)
      .where(eq(schema.eventPlans.id, planId))
      .limit(1);

    if (!plan) {
      throw new NotFoundException(`Event plan ${planId} not found`);
    }

    if (plan.creatorId !== userId) {
      throw new ForbiddenException('Only the plan creator can cancel it');
    }

    if (plan.status !== 'polling') {
      throw new BadRequestException(
        `Cannot cancel a plan with status "${plan.status}"`,
      );
    }

    // Delete the active poll message
    if (plan.pollChannelId && plan.pollMessageId) {
      try {
        await this.discordClient.deleteMessage(
          plan.pollChannelId,
          plan.pollMessageId,
        );
      } catch (error) {
        this.logger.warn(
          `Failed to delete poll message for plan ${planId}:`,
          error,
        );
      }
    }

    // Remove the pending delayed job
    const jobId = `plan-poll-close-${planId}`;
    const job = await this.queue.getJob(jobId);
    if (job) {
      await job.remove();
    }

    // Update status
    const [updated] = await this.db
      .update(schema.eventPlans)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(schema.eventPlans.id, planId))
      .returning();

    // DM the organizer
    await this.dmOrganizer(
      plan.creatorId,
      `Your event plan "${plan.title}" has been cancelled.`,
    );

    this.logger.log(`Event plan ${planId} cancelled by user ${userId}`);
    return this.toResponseDto(updated);
  }

  /**
   * Process a poll close event. Called by the BullMQ processor.
   */
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

    // Fetch poll results from Discord
    let results: Map<number, number>;
    try {
      results = await this.fetchPollResults(
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
    const noneIndex = pollOptions.length; // "None of these work" is always last
    const noneVotes = results.get(noneIndex) ?? 0;

    if (plan.pollMode === 'all_or_nothing' && noneVotes > 0) {
      // Re-poll: shift suggestions forward
      await this.handleRepoll(plan);
      return;
    }

    if (plan.pollMode === 'standard') {
      // Check if "None" has the most votes
      const maxVotes = Math.max(...results.values(), 0);
      if (noneVotes > 0 && noneVotes >= maxVotes) {
        // "None" wins — no event
        await this.db
          .update(schema.eventPlans)
          .set({ status: 'expired', updatedAt: new Date() })
          .where(eq(schema.eventPlans.id, planId));

        await this.dmOrganizer(
          plan.creatorId,
          `The poll for "${plan.title}" closed and "None of these work" got the most votes. No event was created.`,
        );
        return;
      }
    }

    // Find the winner (highest votes, earliest date breaks ties)
    const winnerIndex = this.determineWinner(results, pollOptions, noneIndex);

    if (winnerIndex === null) {
      // No votes at all — expire
      await this.db
        .update(schema.eventPlans)
        .set({ status: 'expired', updatedAt: new Date() })
        .where(eq(schema.eventPlans.id, planId));

      await this.dmOrganizer(
        plan.creatorId,
        `The poll for "${plan.title}" closed with no votes. No event was created.`,
      );
      return;
    }

    // Create the event
    await this.createEventFromPlan(plan, winnerIndex);
  }

  /**
   * Get smart time suggestions for a game.
   */
  async getTimeSuggestions(
    gameId?: number,
    tzOffset?: number,
    afterDate?: string,
  ): Promise<TimeSuggestionsResponse> {
    const offset = tzOffset ?? 0;
    const after = afterDate ? new Date(afterDate) : new Date();

    if (gameId) {
      // Query game_interests for users who want to play this game
      const interests = await this.db
        .select({ userId: schema.gameInterests.userId })
        .from(schema.gameInterests)
        .where(eq(schema.gameInterests.gameId, gameId));

      const userIds = interests.map((i) => i.userId);

      if (userIds.length > 0) {
        // Fetch their game time templates
        const templates = await this.db
          .select({
            dayOfWeek: schema.gameTimeTemplates.dayOfWeek,
            startHour: schema.gameTimeTemplates.startHour,
          })
          .from(schema.gameTimeTemplates)
          .where(inArray(schema.gameTimeTemplates.userId, userIds));

        if (templates.length > 0) {
          // Aggregate by (dayOfWeek, hour), rank by count
          const countMap = new Map<string, number>();
          for (const t of templates) {
            const key = `${t.dayOfWeek}:${t.startHour}`;
            countMap.set(key, (countMap.get(key) ?? 0) + 1);
          }

          // Sort by count desc, then map to concrete dates
          const ranked = Array.from(countMap.entries())
            .sort(([, a], [, b]) => b - a)
            .slice(0, 21); // top 21 day/hour combos

          const suggestions = this.mapToConcreteDates(
            ranked,
            offset,
            after,
            14,
          );

          return {
            source: 'game-interest',
            interestedPlayerCount: userIds.length,
            suggestions: suggestions.slice(0, 20),
          };
        }
      }
    }

    // Fallback: generic presets (next 7 days x evening blocks)
    return {
      source: 'fallback',
      interestedPlayerCount: 0,
      suggestions: this.generateFallbackSuggestions(offset, after),
    };
  }

  // ============================================================
  // Private helpers
  // ============================================================

  /**
   * Post a Discord poll using the native poll API.
   * Returns the message ID.
   */
  private async postDiscordPoll(
    channelId: string,
    _planId: string,
    title: string,
    options: Array<{ date: string; label: string }>,
    durationHours: number,
    round: number,
  ): Promise<string> {
    const client = this.discordClient.getClient();
    if (!client?.isReady()) {
      throw new Error('Discord bot is not connected');
    }

    const channel = await client.channels.fetch(channelId);
    if (!channel || !('send' in channel)) {
      throw new Error(`Channel ${channelId} not found or not a text channel`);
    }

    const textChannel = channel as import('discord.js').TextChannel;

    const pollAnswers = [
      ...options.map((opt) => ({ text: opt.label })),
      { text: 'None of these work' },
    ];

    const content =
      round > 1
        ? `Not everyone was available — here are new time options! (Round ${round})`
        : undefined;

    const message = await textChannel.send({
      content,
      poll: {
        question: { text: `When should we play "${title}"?` },
        answers: pollAnswers,
        duration: durationHours,
        allowMultiselect: true,
      },
    });

    return message.id;
  }

  /**
   * Fetch poll results from a Discord message.
   * Returns a Map of answer index -> vote count.
   */
  private async fetchPollResults(
    channelId: string,
    messageId: string,
  ): Promise<Map<number, number>> {
    const client = this.discordClient.getClient();
    if (!client?.isReady()) {
      throw new Error('Discord bot is not connected');
    }

    const channel = await client.channels.fetch(channelId);
    if (!channel || !('messages' in channel)) {
      throw new Error(`Channel ${channelId} not found`);
    }

    const textChannel = channel as import('discord.js').TextChannel;
    const message = await textChannel.messages.fetch(messageId);

    const results = new Map<number, number>();

    if (message.poll?.answers) {
      let idx = 0;
      for (const [, answer] of message.poll.answers) {
        results.set(idx, answer.voteCount);
        idx++;
      }
    }

    return results;
  }

  /**
   * Determine the winning option index.
   * Highest votes wins; earliest date breaks ties.
   */
  private determineWinner(
    results: Map<number, number>,
    options: Array<{ date: string; label: string }>,
    noneIndex: number,
  ): number | null {
    let bestIndex: number | null = null;
    let bestVotes = 0;
    let bestDate = Infinity;

    for (const [idx, votes] of results.entries()) {
      if (idx === noneIndex) continue; // skip "None"
      if (idx >= options.length) continue;
      const optionDate = new Date(options[idx].date).getTime();

      if (votes > bestVotes || (votes === bestVotes && optionDate < bestDate)) {
        bestIndex = idx;
        bestVotes = votes;
        bestDate = optionDate;
      }
    }

    return bestIndex;
  }

  /**
   * Handle All-or-Nothing re-poll when someone voted "None".
   */
  private async handleRepoll(
    plan: typeof schema.eventPlans.$inferSelect,
  ): Promise<void> {
    const pollOptions = plan.pollOptions as Array<{
      date: string;
      label: string;
    }>;

    // Find the latest polled date
    const latestDate = pollOptions.reduce((max, opt) => {
      const d = new Date(opt.date).getTime();
      return d > max ? d : max;
    }, 0);

    const afterDate = new Date(latestDate + 24 * 3600 * 1000); // +1 day

    // Get fresh suggestions
    const suggestions = await this.getTimeSuggestions(
      plan.gameId ?? undefined,
      0,
      afterDate.toISOString(),
    );

    if (suggestions.suggestions.length < 2) {
      // Not enough suggestions — expire
      await this.db
        .update(schema.eventPlans)
        .set({ status: 'expired', updatedAt: new Date() })
        .where(eq(schema.eventPlans.id, plan.id));

      await this.dmOrganizer(
        plan.creatorId,
        `The poll for "${plan.title}" couldn't generate enough new time options. The plan has expired.`,
      );
      return;
    }

    const newOptions = suggestions.suggestions
      .slice(0, 9)
      .map((s) => ({ date: s.date, label: s.label }));

    // Delete or edit old poll message
    if (plan.pollChannelId && plan.pollMessageId) {
      try {
        await this.discordClient.deleteMessage(
          plan.pollChannelId,
          plan.pollMessageId,
        );
      } catch {
        // Best effort — message may already be gone
      }
    }

    const newRound = (plan.pollRound ?? 1) + 1;

    // Post new poll
    let newMessageId: string;
    try {
      newMessageId = await this.postDiscordPoll(
        plan.pollChannelId!,
        plan.id,
        plan.title,
        newOptions,
        plan.pollDurationHours,
        newRound,
      );
    } catch (error) {
      this.logger.error(`Failed to post re-poll for plan ${plan.id}:`, error);
      await this.db
        .update(schema.eventPlans)
        .set({ status: 'expired', updatedAt: new Date() })
        .where(eq(schema.eventPlans.id, plan.id));
      return;
    }

    // Update plan record
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

    // Schedule new delayed job
    await this.queue.add(
      'poll-closed',
      { planId: plan.id } satisfies PollClosedJobData,
      {
        jobId: `plan-poll-close-${plan.id}`,
        delay: plan.pollDurationHours * 3600 * 1000,
        removeOnComplete: true,
        removeOnFail: 50,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );

    this.logger.log(`Re-poll posted for plan ${plan.id}, round ${newRound}`);
  }

  /**
   * Create an event from a completed plan.
   */
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
        reminder15min: plan.reminder15min,
        reminder1hour: plan.reminder1hour,
        reminder24hour: plan.reminder24hour,
      });

      // Auto-signup creator
      await this.signupsService.signup(event.id, plan.creatorId);

      // Update plan status
      await this.db
        .update(schema.eventPlans)
        .set({
          status: 'completed',
          winningOption: winnerIndex,
          createdEventId: event.id,
          updatedAt: new Date(),
        })
        .where(eq(schema.eventPlans.id, plan.id));

      await this.dmOrganizer(
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

  /**
   * Map ranked (dayOfWeek, hour) pairs to concrete ISO dates.
   * dayOfWeek from DB is 0=Mon...6=Sun.
   */
  private mapToConcreteDates(
    ranked: Array<[string, number]>,
    tzOffset: number,
    after: Date,
    daysAhead: number,
  ): TimeSuggestion[] {
    const suggestions: TimeSuggestion[] = [];
    const endDate = new Date(after.getTime() + daysAhead * 24 * 3600 * 1000);

    for (const [key, count] of ranked) {
      const [dow, hour] = key.split(':').map(Number);
      // Convert DB dayOfWeek (0=Mon) to JS Date.getDay() (0=Sun)
      const jsDow = (dow + 1) % 7;

      // Find the next occurrence of this day after `after`
      const cursor = new Date(after);
      cursor.setMinutes(0, 0, 0);
      // Adjust for timezone offset
      cursor.setHours(hour);

      // Find the next matching day of week
      while (cursor.getDay() !== jsDow || cursor <= after) {
        cursor.setDate(cursor.getDate() + 1);
        cursor.setHours(hour, 0, 0, 0);
      }

      // Generate concrete dates for matching days within the window
      while (cursor < endDate) {
        const label = cursor.toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        });

        suggestions.push({
          date: cursor.toISOString(),
          label,
          availableCount: count,
        });

        cursor.setDate(cursor.getDate() + 7);
      }
    }

    // Sort by availableCount desc, then date asc
    suggestions.sort((a, b) => {
      if (b.availableCount !== a.availableCount)
        return b.availableCount - a.availableCount;
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });

    return suggestions;
  }

  /**
   * Generate fallback suggestions: next 7 days x evening blocks (6-10 PM).
   */
  private generateFallbackSuggestions(
    tzOffset: number,
    after: Date,
  ): TimeSuggestion[] {
    const suggestions: TimeSuggestion[] = [];
    const eveningHours = [18, 19, 20, 21]; // 6 PM - 9 PM

    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      for (const hour of eveningHours) {
        const date = new Date(after);
        date.setDate(date.getDate() + dayOffset + 1);
        date.setHours(hour, 0, 0, 0);

        // Skip if in the past
        if (date <= after) continue;

        const label = date.toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        });

        suggestions.push({
          date: date.toISOString(),
          label,
          availableCount: 0,
        });
      }
    }

    return suggestions;
  }

  /**
   * DM the organizer (best effort).
   */
  private async dmOrganizer(userId: number, message: string): Promise<void> {
    try {
      const [user] = await this.db
        .select({ discordId: schema.users.discordId })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);

      if (user?.discordId) {
        await this.discordClient.sendDirectMessage(user.discordId, message);
      }
    } catch (error) {
      this.logger.warn(
        `Failed to DM organizer ${userId}:`,
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  }

  /**
   * Convert a DB row to the response DTO.
   */
  private toResponseDto(
    plan: typeof schema.eventPlans.$inferSelect,
  ): EventPlanResponseDto {
    return {
      id: plan.id,
      creatorId: plan.creatorId,
      title: plan.title,
      description: plan.description,
      gameId: plan.gameId,
      slotConfig: plan.slotConfig as EventPlanResponseDto['slotConfig'],
      maxAttendees: plan.maxAttendees,
      autoUnbench: plan.autoUnbench,
      durationMinutes: plan.durationMinutes,
      pollOptions: plan.pollOptions as EventPlanResponseDto['pollOptions'],
      pollDurationHours: plan.pollDurationHours,
      pollMode: plan.pollMode as EventPlanResponseDto['pollMode'],
      pollRound: plan.pollRound,
      pollChannelId: plan.pollChannelId,
      pollMessageId: plan.pollMessageId,
      status: plan.status as EventPlanResponseDto['status'],
      winningOption: plan.winningOption,
      createdEventId: plan.createdEventId,
      pollStartedAt: plan.pollStartedAt?.toISOString() ?? null,
      pollEndsAt: plan.pollEndsAt?.toISOString() ?? null,
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
    };
  }
}

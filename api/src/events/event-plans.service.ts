import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
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
  toResponseDto,
} from './event-plans-poll.helpers';
import { dmOrganizer } from './event-plans-discord.helpers';
import { buildPollResultsResponse } from './event-plans-lifecycle.helpers';
import { insertPlan } from './event-plans-crud.helpers';
import { getTimeSuggestions } from './event-plans-time.helpers';
import {
  restartPlan,
  processPollResults,
  executeConversion,
} from './event-plans-ops.helpers';
import {
  postPollForPlan,
  assertEventOwnerOrPrivileged,
  assertCreatorOrPrivileged,
  emptyPollResults,
  fetchResultsOrThrow,
  tryCancelOriginal,
  buildOpsDeps,
} from './event-plans-service.helpers';

export const EVENT_PLANS_QUEUE = 'event-plans';
export interface PollClosedJobData {
  planId: string;
}
export type { PollAnswerResult };
type PlanRow = typeof schema.eventPlans.$inferSelect;

@Injectable()
export class EventPlansService {
  private readonly logger = new Logger(EventPlansService.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private db: PostgresJsDatabase<typeof schema>,
    @InjectQueue(EVENT_PLANS_QUEUE) private queue: Queue,
    private readonly discordClient: DiscordBotClientService,
    private readonly channelResolver: ChannelResolverService,
    private readonly settingsService: SettingsService,
    private readonly eventsService: EventsService,
    private readonly signupsService: SignupsService,
  ) {}

  /** Creates a new event plan and posts a Discord poll. */
  async create(
    creatorId: number,
    dto: CreateEventPlanDto,
  ): Promise<EventPlanResponseDto> {
    this.assertDiscordConnected();
    const channelId = await this.resolveChannelOrThrow(dto.gameId);
    const plan = await insertPlan(this.db, creatorId, dto, channelId);
    plan.pollMessageId = await postPollForPlan(
      this.discordClient,
      this.db,
      channelId,
      plan.id,
      dto.title,
      dto.pollOptions,
      dto.pollDurationHours,
      1,
      dto,
    );
    await this.schedulePollClose(plan.id, dto.pollDurationHours * 3600 * 1000);
    return toResponseDto(plan);
  }

  /** Converts an existing event into a plan with a Discord poll. */
  async convertFromEvent(
    eventId: number,
    userId: number,
    userRole?: string,
    options?: ConvertEventToPlanDto,
  ): Promise<EventPlanResponseDto> {
    const event = await this.eventsService.findOne(eventId);
    assertEventOwnerOrPrivileged(event, userId, userRole);
    const { dto } = await executeConversion(
      this.opsDeps(),
      event,
      userId,
      this.settingsService,
      options,
    );
    await tryCancelOriginal(
      this.eventsService,
      eventId,
      userId,
      userRole,
      options?.cancelOriginal,
    );
    return dto;
  }

  async findOne(planId: string): Promise<EventPlanResponseDto> {
    return toResponseDto(await this.findPlanOrThrow(planId));
  }

  async findAll(): Promise<EventPlanResponseDto[]> {
    const plans = await this.db
      .select()
      .from(schema.eventPlans)
      .orderBy(schema.eventPlans.createdAt);
    return plans.map((p) => toResponseDto(p));
  }

  /** Cancels a polling plan. */
  async cancel(
    planId: string,
    userId: number,
    userRole?: string,
  ): Promise<EventPlanResponseDto> {
    const plan = await this.findPlanOrThrow(planId);
    assertCreatorOrPrivileged(plan, userId, userRole, 'cancel it');
    if (plan.status !== 'polling')
      throw new BadRequestException(
        `Cannot cancel a plan with status "${plan.status}"`,
      );
    await this.cleanupPoll(plan, planId);
    const [updated] = await this.db
      .update(schema.eventPlans)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(schema.eventPlans.id, planId))
      .returning();
    this.safeDmOrganizer(
      plan.creatorId,
      `Your event plan "${plan.title}" has been cancelled.`,
    );
    return toResponseDto(updated);
  }

  /** Returns live poll results for a plan. */
  async getPollResults(
    planId: string,
    userId: number,
    userRole?: string,
  ): Promise<PollResultsResponse> {
    const plan = await this.findPlanOrThrow(planId);
    assertCreatorOrPrivileged(plan, userId, userRole, 'view poll results');
    if (plan.status !== 'polling') return emptyPollResults(plan);
    const rawResults = await fetchResultsOrThrow(
      this.db,
      this.discordClient,
      plan,
    );
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

  /** Restarts a cancelled/expired/draft plan. */
  async restart(
    planId: string,
    userId: number,
    userRole?: string,
  ): Promise<EventPlanResponseDto> {
    const plan = await this.findPlanOrThrow(planId);
    assertCreatorOrPrivileged(plan, userId, userRole, 'restart it');
    if (!['cancelled', 'expired', 'draft'].includes(plan.status)) {
      throw new BadRequestException(
        `Can only restart cancelled/expired/draft plans, got "${plan.status}"`,
      );
    }
    return restartPlan(this.opsDeps(), plan);
  }

  /** Job handler: processes poll close. */
  async processPollClose(planId: string): Promise<void> {
    const [plan] = await this.db
      .select()
      .from(schema.eventPlans)
      .where(eq(schema.eventPlans.id, planId))
      .limit(1);
    if (!plan || plan.status !== 'polling') return;
    await processPollResults(this.opsDeps(), this.settingsService, plan);
  }

  async getTimeSuggestions(
    gameId?: number,
    tzOffset?: number,
    afterDate?: string,
  ): Promise<TimeSuggestionsResponse> {
    return getTimeSuggestions(
      this.db,
      this.settingsService,
      gameId,
      tzOffset,
      afterDate,
    );
  }

  // ── Private ─────────────────────────────────────────────────

  private opsDeps() {
    return buildOpsDeps(
      this.db,
      this.discordClient,
      this.channelResolver,
      this.eventsService,
      this.signupsService,
      (id, ms) => this.schedulePollClose(id, ms),
      (p) => this.tryDeletePollMessage(p),
    );
  }

  private assertDiscordConnected(): void {
    if (!this.discordClient.isConnected())
      throw new ServiceUnavailableException(
        'The Discord bot is not connected.',
      );
  }

  private async resolveChannelOrThrow(
    gameId: number | null | undefined,
  ): Promise<string> {
    const ch = await this.channelResolver.resolveChannelForEvent(
      gameId ?? null,
    );
    if (!ch)
      throw new BadRequestException(
        'No Discord channel configured for this game.',
      );
    return ch;
  }

  private async findPlanOrThrow(planId: string): Promise<PlanRow> {
    const [plan] = await this.db
      .select()
      .from(schema.eventPlans)
      .where(eq(schema.eventPlans.id, planId))
      .limit(1);
    if (!plan) throw new NotFoundException(`Event plan ${planId} not found`);
    return plan;
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

  private async cleanupPoll(plan: PlanRow, planId: string): Promise<void> {
    await this.tryDeletePollMessage(plan);
    const job = await this.queue.getJob(`plan-poll-close-${planId}`);
    if (job) await job.remove();
  }

  private async tryDeletePollMessage(plan: PlanRow): Promise<void> {
    if (!plan.pollChannelId || !plan.pollMessageId) return;
    try {
      await this.discordClient.deleteMessage(
        plan.pollChannelId,
        plan.pollMessageId,
      );
    } catch (e) {
      this.logger.warn(`Poll message delete failed:`, e);
    }
  }

  private safeDmOrganizer(userId: number, msg: string): void {
    dmOrganizer(this.db, this.discordClient, userId, msg).catch((e) =>
      this.logger.warn(
        `DM failed:`,
        e instanceof Error ? e.message : 'Unknown',
      ),
    );
  }
}

import { Inject, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { QueueHealthService } from '../../queue/queue-health.service';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { isPerfEnabled, perfLog } from '../../common/perf-logger';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { EmbedPosterService } from '../services/embed-poster.service';
import { ScheduledEventService } from '../services/scheduled-event.service';
import { SettingsService } from '../../settings/settings.service';
import { GameAffinityNotificationService } from '../../notifications/game-affinity-notification.service';
import {
  shouldPostEmbed,
  getLeadTimeFromRecurrence,
} from '../utils/embed-lead-time';
import {
  EVENT_LIFECYCLE_QUEUE,
  type EventLifecycleJobData,
} from '../queues/event-lifecycle.queue';

/** Default lead time for standalone (non-recurring) events: 6 days. */
const STANDALONE_LEAD_TIME_MS = 6 * 24 * 60 * 60 * 1000;

/**
 * BullMQ processor for the event-lifecycle queue (ROK-858).
 *
 * Handles post-creation Discord work: scheduled event creation,
 * embed posting, and game affinity notification dispatch.
 * Retries up to 3 times with exponential backoff.
 */
@Processor(EVENT_LIFECYCLE_QUEUE)
export class EventLifecycleProcessor
  extends WorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(EventLifecycleProcessor.name);

  constructor(
    @InjectQueue(EVENT_LIFECYCLE_QUEUE)
    private readonly queue: Queue,
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly embedPoster: EmbedPosterService,
    private readonly scheduledEventService: ScheduledEventService,
    private readonly settingsService: SettingsService,
    @Optional()
    @Inject(GameAffinityNotificationService)
    private readonly gameAffinityService: GameAffinityNotificationService | null,
    private readonly queueHealth: QueueHealthService,
  ) {
    super();
  }

  onModuleInit() {
    this.queueHealth.register(this.queue);
  }

  async process(job: Job<EventLifecycleJobData>): Promise<void> {
    const { eventId, payload } = job.data;
    const start = isPerfEnabled() ? performance.now() : 0;

    this.logger.log(`Processing event lifecycle for event ${eventId}`);

    if (!this.clientService.isConnected()) {
      this.logger.warn(`Bot not connected, skipping event ${eventId}`);
      return;
    }

    this.fireScheduledEventCreate(payload);

    if (!this.isWithinLeadTime(payload)) {
      this.logger.log(
        `Event ${eventId} outside lead-time window, skipping embed/notifications`,
      );
      return;
    }

    const posted = await this.postEmbed(payload);
    await this.sendGameAffinityNotifications(payload, posted);

    if (start) {
      perfLog('QUEUE', 'event-lifecycle', performance.now() - start, {
        eventId,
      });
    }
  }

  /** Check if the event is within the lead-time window for embed posting. */
  private isWithinLeadTime(payload: EventLifecycleJobData['payload']): boolean {
    const rule = payload.recurrenceRule ?? null;
    const leadTimeMs =
      getLeadTimeFromRecurrence(rule) ?? STANDALONE_LEAD_TIME_MS;
    return shouldPostEmbed(payload.event.startTime, leadTimeMs, 'UTC');
  }

  /** Fire-and-forget Discord scheduled event creation. */
  private fireScheduledEventCreate(
    payload: EventLifecycleJobData['payload'],
  ): void {
    this.scheduledEventService
      .createScheduledEvent(
        payload.eventId,
        payload.event,
        payload.gameId,
        payload.isAdHoc,
        payload.notificationChannelOverride,
      )
      .catch((err: unknown) => {
        this.logger.warn(
          `Failed to create scheduled event for ${payload.eventId}: ${String(err)}`,
        );
      });
  }

  /** Post the embed and return whether it succeeded. */
  private async postEmbed(
    payload: EventLifecycleJobData['payload'],
  ): Promise<boolean> {
    return this.embedPoster.postEmbed(
      payload.eventId,
      payload.event,
      payload.gameId,
      payload.recurrenceGroupId,
      payload.notificationChannelOverride,
    );
  }

  /** Send game affinity notifications if eligible. */
  private async sendGameAffinityNotifications(
    payload: EventLifecycleJobData['payload'],
    posted: boolean,
  ): Promise<void> {
    if (!this.canSendAffinityNotification(payload)) return;

    const discordMessage = posted
      ? await this.findDiscordMessage(payload.eventId)
      : null;
    const clientUrl = await this.settingsService.getClientUrl();

    try {
      await this.gameAffinityService!.notifyGameAffinity({
        eventId: payload.eventId,
        eventTitle: payload.event.title,
        gameName: payload.event.game!.name,
        gameId: payload.gameId!,
        startTime: payload.event.startTime,
        endTime: payload.event.endTime,
        creatorId: payload.creatorId!,
        clientUrl,
        gameCoverUrl: payload.event.game!.coverUrl,
        discordMessage,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to send game affinity notifications: ${String(err)}`,
      );
    }
  }

  /** Check if all required fields exist for affinity notification. */
  private canSendAffinityNotification(
    payload: EventLifecycleJobData['payload'],
  ): boolean {
    return !!(
      this.gameAffinityService &&
      payload.gameId &&
      payload.event.game?.name &&
      payload.creatorId
    );
  }

  /** Look up the Discord message record for the event. */
  private async findDiscordMessage(eventId: number): Promise<{
    guildId: string;
    channelId: string;
    messageId: string;
  } | null> {
    const [record] = await this.db
      .select({
        guildId: schema.discordEventMessages.guildId,
        channelId: schema.discordEventMessages.channelId,
        messageId: schema.discordEventMessages.messageId,
      })
      .from(schema.discordEventMessages)
      .where(eq(schema.discordEventMessages.eventId, eventId))
      .limit(1);
    return record ?? null;
  }
}

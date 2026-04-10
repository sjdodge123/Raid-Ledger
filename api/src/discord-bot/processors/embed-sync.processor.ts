import { Inject, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { QueueHealthService } from '../../queue/queue-health.service';
import { isPerfEnabled, perfLog } from '../../common/perf-logger';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot-client.service';
import {
  DiscordEmbedFactory,
  type EmbedEventData,
  type EmbedContext,
} from '../services/discord-embed.factory';
import { ScheduledEventService } from '../services/scheduled-event.service';
import { ChannelResolverService } from '../services/channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';
import { EMBED_STATES, type EmbedState } from '../discord-bot.constants';
import {
  EMBED_SYNC_QUEUE,
  type EmbedSyncJobData,
} from '../queues/embed-sync.queue';
import {
  findTrackedMessages,
  buildEventData,
  computeEmbedState,
} from './embed-sync.helpers';

/**
 * BullMQ processor for the discord-embed-sync queue (ROK-119).
 *
 * Fetches the latest event data, computes the correct embed state,
 * rebuilds the embed via DiscordEmbedFactory, and edits the Discord message.
 * Retries up to 3 times with exponential backoff.
 */
@Processor(EMBED_SYNC_QUEUE)
export class EmbedSyncProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(EmbedSyncProcessor.name);

  constructor(
    @InjectQueue(EMBED_SYNC_QUEUE)
    private readonly queue: Queue,
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly embedFactory: DiscordEmbedFactory,
    private readonly settingsService: SettingsService,
    private readonly scheduledEventService: ScheduledEventService,
    private readonly channelResolver: ChannelResolverService,
    private readonly queueHealth: QueueHealthService,
  ) {
    super();
  }

  onModuleInit() {
    this.queueHealth.register(this.queue);
  }

  async process(job: Job<EmbedSyncJobData>): Promise<void> {
    const { eventId, reason } = job.data;
    const start = isPerfEnabled() ? performance.now() : 0;

    this.logger.debug(
      `Processing embed sync for event ${eventId} (reason: ${reason})`,
    );

    const guildId = this.requireConnection();
    if (!guildId) return;

    const records = await findTrackedMessages(this.db, eventId, guildId);
    const active = records.filter(
      (r) => r.embedState !== EMBED_STATES.CANCELLED,
    );
    if (active.length === 0) return;

    const event = await this.fetchEvent(eventId);
    if (!event || event.cancelledAt) return;

    const eventData = await buildEventData(
      this.db,
      event,
      this.channelResolver,
    );
    const newState = computeEmbedState(event, eventData);
    const context = await this.buildContext();

    await this.syncAllMessages(active, eventData, newState, context, eventId);
    this.logAndTriggerSideEffects(
      active,
      newState,
      eventId,
      eventData,
      reason,
      start,
    );
  }

  /** Validate bot connection, return guildId or null. */
  private requireConnection(): string | null {
    if (!this.clientService.isConnected()) {
      this.logger.warn('Discord bot not connected, failing job for retry');
      throw new Error('Discord bot not connected');
    }
    const guildId = this.clientService.getGuildId();
    if (!guildId) {
      this.logger.warn('Bot not in any guild, skipping embed sync');
    }
    return guildId;
  }

  /** Fetch an event by ID, returning null if not found. */
  private async fetchEvent(
    eventId: number,
  ): Promise<typeof schema.events.$inferSelect | null> {
    const [event] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);
    if (!event) {
      this.logger.warn(`Event ${eventId} not found, skipping embed sync`);
    }
    return event ?? null;
  }

  /** Sync all tracked messages, catching errors per-message. */
  private async syncAllMessages(
    records: (typeof schema.discordEventMessages.$inferSelect)[],
    eventData: EmbedEventData,
    newState: EmbedState,
    context: EmbedContext,
    eventId: number,
  ): Promise<void> {
    const { embed, row, content } = this.embedFactory.buildEventUpdate(
      eventData,
      context,
      newState,
    );
    for (const record of records) {
      await this.syncSingleMessage(
        record,
        embed,
        row,
        content,
        newState,
        eventId,
      );
    }
  }

  /** Edit a single Discord message, persist state, and clean up bumps. */
  private async syncSingleMessage(
    record: typeof schema.discordEventMessages.$inferSelect,
    embed: ReturnType<DiscordEmbedFactory['buildEventUpdate']>['embed'],
    row: ReturnType<DiscordEmbedFactory['buildEventUpdate']>['row'],
    content: ReturnType<DiscordEmbedFactory['buildEventUpdate']>['content'],
    newState: EmbedState,
    eventId: number,
  ): Promise<void> {
    try {
      await this.clientService.editEmbed(
        record.channelId,
        record.messageId,
        embed,
        row,
        content,
      );
      await this.persistState(record.id, newState);
      await this.maybeDeleteBumpMessage(record, newState, eventId);
    } catch (err) {
      this.logger.warn(
        `Failed to sync embed in channel ${record.channelId} ` +
          `for event ${eventId}: ${err instanceof Error ? err.message : 'Unknown'}`,
      );
    }
  }

  /** Log state transitions and trigger side effects ONCE for all messages. */
  private logAndTriggerSideEffects(
    records: (typeof schema.discordEventMessages.$inferSelect)[],
    newState: EmbedState,
    eventId: number,
    eventData: EmbedEventData,
    reason: string,
    perfStart: number,
  ): void {
    const previousState = records[0]?.embedState as EmbedState | undefined;
    if (previousState && newState !== previousState) {
      this.logger.log(
        `Embed state transition for event ${eventId}: ${previousState} -> ${newState}`,
      );
    }
    this.logger.log(
      `Synced embed for event ${eventId} (state: ${newState}, reason: ${reason})`,
    );
    if (perfStart) {
      perfLog('QUEUE', 'embed-sync', performance.now() - perfStart, {
        eventId,
        reason,
      });
    }
    this.triggerSideEffects(newState, eventId, eventData);
  }

  /** Persist the new embed state in the database. */
  private async persistState(
    recordId: string,
    newState: EmbedState,
  ): Promise<void> {
    await this.db
      .update(schema.discordEventMessages)
      .set({ embedState: newState, updatedAt: new Date() })
      .where(eq(schema.discordEventMessages.id, recordId));
  }

  /** Delete the recruitment bump message when the event becomes full (ROK-728). */
  private async maybeDeleteBumpMessage(
    record: typeof schema.discordEventMessages.$inferSelect,
    newState: EmbedState,
    eventId: number,
  ): Promise<void> {
    if (newState !== EMBED_STATES.FULL || !record.bumpMessageId) return;
    try {
      await this.clientService.deleteMessage(
        record.channelId,
        record.bumpMessageId,
      );
      await this.db
        .update(schema.discordEventMessages)
        .set({ bumpMessageId: null, updatedAt: new Date() })
        .where(eq(schema.discordEventMessages.id, record.id));
      this.logger.log(`Deleted recruitment bump message for event ${eventId}`);
    } catch (err) {
      this.logger.warn(
        `Failed to delete bump message for event ${eventId}: ${err instanceof Error ? err.message : 'Unknown'}`,
      );
    }
  }

  /** Trigger scheduled event side effects based on new state. */
  private triggerSideEffects(
    newState: EmbedState,
    eventId: number,
    eventData: EmbedEventData,
  ): void {
    if (newState === EMBED_STATES.COMPLETED) {
      this.scheduledEventService
        .completeScheduledEvent(eventId)
        .catch((err: unknown) => {
          this.logger.warn(
            `Failed to complete scheduled event for ${eventId}: ${err instanceof Error ? err.message : 'Unknown'}`,
          );
        });
    } else {
      this.scheduledEventService
        .updateDescription(eventId, eventData)
        .catch((err: unknown) => {
          this.logger.warn(
            `Failed to update scheduled event for ${eventId}: ${err instanceof Error ? err.message : 'Unknown'}`,
          );
        });
    }
  }

  /** Build shared embed context from settings. */
  private async buildContext(): Promise<EmbedContext> {
    const [branding, clientUrl, timezone] = await Promise.all([
      this.settingsService.getBranding(),
      this.settingsService.getClientUrl(),
      this.settingsService.getDefaultTimezone(),
    ]);
    return { communityName: branding.communityName, clientUrl, timezone };
  }
}

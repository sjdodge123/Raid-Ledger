import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
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
  findTrackedMessage,
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
export class EmbedSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(EmbedSyncProcessor.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly embedFactory: DiscordEmbedFactory,
    private readonly settingsService: SettingsService,
    private readonly scheduledEventService: ScheduledEventService,
    private readonly channelResolver: ChannelResolverService,
  ) {
    super();
  }

  async process(job: Job<EmbedSyncJobData>): Promise<void> {
    const { eventId, reason } = job.data;
    const start = isPerfEnabled() ? performance.now() : 0;

    this.logger.debug(
      `Processing embed sync for event ${eventId} (reason: ${reason})`,
    );

    const guildId = this.requireConnection();
    if (!guildId) return;

    const record = await findTrackedMessage(this.db, eventId, guildId);
    if (!record) return;
    if (record.embedState === EMBED_STATES.CANCELLED) return;

    const event = await this.fetchEvent(eventId);
    if (!event || event.cancelledAt) return;

    const eventData = await buildEventData(
      this.db,
      event,
      this.channelResolver,
    );
    const newState = computeEmbedState(event, eventData);
    await this.editAndSync(record, eventData, newState, eventId, reason, start);
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

  /** Build embed, edit Discord message, update state, trigger side effects. */
  private async editAndSync(
    record: typeof schema.discordEventMessages.$inferSelect,
    eventData: EmbedEventData,
    newState: EmbedState,
    eventId: number,
    reason: string,
    perfStart: number,
  ): Promise<void> {
    const previousState = record.embedState as EmbedState;
    const context = await this.buildContext();
    const { embed, row } = this.embedFactory.buildEventUpdate(
      eventData,
      context,
      newState,
    );
    await this.clientService.editEmbed(
      record.channelId,
      record.messageId,
      embed,
      row,
    );
    await this.persistState(record.id, newState);
    this.logTransition(previousState, newState, eventId, reason, perfStart);
    this.triggerSideEffects(newState, eventId, eventData);
  }

  /** Persist the new embed state in the database. */
  private async persistState(
    recordId: number,
    newState: EmbedState,
  ): Promise<void> {
    await this.db
      .update(schema.discordEventMessages)
      .set({ embedState: newState, updatedAt: new Date() })
      .where(eq(schema.discordEventMessages.id, recordId));
  }

  /** Log state transition and performance data. */
  private logTransition(
    prev: EmbedState,
    next: EmbedState,
    eventId: number,
    reason: string,
    perfStart: number,
  ): void {
    if (next !== prev) {
      this.logger.log(
        `Embed state transition for event ${eventId}: ${prev} -> ${next}`,
      );
    }
    this.logger.log(
      `Synced embed for event ${eventId} (state: ${next}, reason: ${reason})`,
    );
    if (perfStart) {
      perfLog('QUEUE', 'embed-sync', performance.now() - perfStart, {
        eventId,
        reason,
      });
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

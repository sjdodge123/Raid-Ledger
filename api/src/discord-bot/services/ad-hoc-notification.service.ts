import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot-client.service';
import {
  DiscordEmbedFactory,
  type EmbedEventData,
} from './discord-embed.factory';
import { EMBED_STATES } from '../discord-bot.constants';
import { ChannelBindingsService } from './channel-bindings.service';
import { ChannelResolverService } from './channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';
import {
  type AdHocNotificationDeps,
  buildContext,
  buildEmbedEventData,
  resolveNotificationChannel,
  toActiveParticipants,
  toInactiveParticipants,
} from './ad-hoc-notification.helpers';

/** Batch flush interval for embed updates (ms). */
const BATCH_FLUSH_INTERVAL_MS = 5000;

interface PendingUpdate {
  eventId: number;
  bindingId: string;
}

/**
 * AdHocNotificationService — handles Discord embed notifications for ad-hoc events (ROK-293).
 *
 * Features:
 * - Posts an embed when an ad-hoc event spawns
 * - Batched edit-in-place updates as players join/leave (5s flush interval)
 * - Posts a final summary embed when the event completes
 *
 * Uses the standard buildEventEmbed() layout so ad-hoc embeds match
 * the look of scheduled event embeds (game cover art, roster, timestamps).
 */
@Injectable()
export class AdHocNotificationService implements OnModuleDestroy {
  private readonly logger = new Logger(AdHocNotificationService.name);
  private messageIds = new Map<
    number,
    { channelId: string; messageId: string }
  >();
  private pendingUpdates = new Map<number, PendingUpdate>();
  private flushTimer: NodeJS.Timeout | null = null;
  private flushing = false;

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly embedFactory: DiscordEmbedFactory,
    private readonly channelBindingsService: ChannelBindingsService,
    private readonly channelResolver: ChannelResolverService,
    private readonly settingsService: SettingsService,
  ) {
    this.startFlushTimer();
  }

  /** Dependency bundle for extracted helper functions. */
  private get deps(): AdHocNotificationDeps {
    return {
      db: this.db,
      channelBindingsService: this.channelBindingsService,
      channelResolver: this.channelResolver,
      settingsService: this.settingsService,
    };
  }

  onModuleDestroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /** Post the initial spawn notification embed. */
  async notifySpawn(
    eventId: number,
    bindingId: string,
    _event: { id: number; title: string; gameName?: string },
    participants: Array<{ discordUserId: string; discordUsername: string }>,
  ): Promise<void> {
    const channelId = await resolveNotificationChannel(this.deps, bindingId);
    if (!channelId) return;
    const active = toActiveParticipants(participants);
    const embedData = await buildEmbedEventData(this.deps, eventId, active);
    if (!embedData) return;
    await this.sendSpawnEmbed(eventId, channelId, embedData);
  }

  /** Send the spawn embed and track the message. */
  private async sendSpawnEmbed(
    eventId: number,
    channelId: string,
    embedData: EmbedEventData,
  ): Promise<void> {
    const { embed, row, content } = await this.buildEmbed(
      embedData,
      EMBED_STATES.LIVE,
    );
    try {
      const message = await this.clientService.sendEmbed(
        channelId,
        embed,
        row,
        content,
      );
      if (message) {
        await this.trackSpawnMessage(eventId, channelId, message.id);
      } else {
        this.logger.warn(`No message returned for event ${eventId}`);
      }
    } catch (err) {
      this.logger.error(
        `Failed to send spawn notification for event ${eventId}: ${err}`,
      );
    }
  }

  /** Track the spawn message and persist to DB. */
  private async trackSpawnMessage(
    eventId: number,
    channelId: string,
    messageId: string,
  ): Promise<void> {
    this.messageIds.set(eventId, { channelId, messageId });
    const guildId = this.clientService.getGuildId();
    if (guildId) {
      await this.db.insert(schema.discordEventMessages).values({
        eventId,
        guildId,
        channelId,
        messageId,
        embedState: EMBED_STATES.LIVE,
      });
    }
  }

  /** Queue an update for batched flush (edit-in-place). */
  queueUpdate(eventId: number, bindingId: string): void {
    this.pendingUpdates.set(eventId, { eventId, bindingId });
  }

  /**
   * Update the existing embed in-place to show the completed state (ROK-612).
   * No second "completed" message is posted — the original embed is edited.
   */
  async notifyCompleted(
    eventId: number,
    _bindingId: string,
    _event: {
      id: number;
      title: string;
      gameName?: string;
      startTime: string;
      endTime: string;
    },
    participants: Array<{
      discordUserId: string;
      discordUsername: string;
      totalDurationSeconds: number | null;
    }>,
  ): Promise<void> {
    const tracked = this.messageIds.get(eventId);
    if (!tracked) {
      this.pendingUpdates.delete(eventId);
      return;
    }
    const inactive = toInactiveParticipants(participants);
    const embedData = await buildEmbedEventData(this.deps, eventId, inactive);
    if (!embedData) {
      this.cleanup(eventId);
      return;
    }
    await this.editTrackedEmbed(tracked, embedData, EMBED_STATES.COMPLETED);
    this.cleanup(eventId);
  }

  /** Clean up tracked state for an event. */
  private cleanup(eventId: number): void {
    this.messageIds.delete(eventId);
    this.pendingUpdates.delete(eventId);
  }

  /** Flush pending updates — edit-in-place the tracked messages. */
  private async flushUpdates(): Promise<void> {
    if (this.flushing || this.pendingUpdates.size === 0) return;
    this.flushing = true;
    try {
      const updates = Array.from(this.pendingUpdates.values());
      this.pendingUpdates.clear();
      for (const update of updates) {
        try {
          await this.processUpdate(update);
        } catch (err) {
          this.logger.error(
            `Failed to flush ad-hoc update for event ${update.eventId}: ${err}`,
          );
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  private async processUpdate(update: PendingUpdate): Promise<void> {
    const tracked = this.messageIds.get(update.eventId);
    if (!tracked) return;
    const rows = await this.db
      .select()
      .from(schema.adHocParticipants)
      .where(eq(schema.adHocParticipants.eventId, update.eventId));
    const participants = rows.map((r) => ({
      discordUserId: r.discordUserId,
      discordUsername: r.discordUsername,
      isActive: !r.leftAt,
    }));
    const embedData = await buildEmbedEventData(
      this.deps,
      update.eventId,
      participants,
    );
    if (!embedData) return;
    await this.editTrackedEmbed(tracked, embedData, EMBED_STATES.LIVE);
  }

  /** Build an embed with context and options. */
  private async buildEmbed(embedData: EmbedEventData, state: string) {
    const context = await buildContext(this.deps);
    const buttons = state === EMBED_STATES.COMPLETED ? 'none' : 'view';
    const opts = { state, buttons } as Parameters<
      DiscordEmbedFactory['buildEventEmbed']
    >[2];
    return this.embedFactory.buildEventEmbed(embedData, context, opts);
  }

  /** Edit a tracked embed message with new data. */
  private async editTrackedEmbed(
    tracked: { channelId: string; messageId: string },
    embedData: EmbedEventData,
    state: string,
  ): Promise<void> {
    const { embed, row, content } = await this.buildEmbed(embedData, state);
    try {
      await this.clientService.editEmbed(
        tracked.channelId,
        tracked.messageId,
        embed,
        row,
        content,
      );
    } catch (err) {
      this.logger.error(`Failed to edit embed: ${err}`);
    }
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flushUpdates().catch((err) => {
        this.logger.error(`Batch flush error: ${err}`);
      });
    }, BATCH_FLUSH_INTERVAL_MS);
  }
}

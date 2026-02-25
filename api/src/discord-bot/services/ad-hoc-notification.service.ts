import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot-client.service';
import {
  DiscordEmbedFactory,
  type EmbedContext,
} from './discord-embed.factory';
import { ChannelBindingsService } from './channel-bindings.service';
import { SettingsService } from '../../settings/settings.service';

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
 */
@Injectable()
export class AdHocNotificationService {
  private readonly logger = new Logger(AdHocNotificationService.name);

  /** Tracks the notification message ID per event for edit-in-place */
  private messageIds = new Map<
    number,
    { channelId: string; messageId: string }
  >();

  /** Pending update events to batch-flush */
  private pendingUpdates = new Map<number, PendingUpdate>();

  /** Flush timer */
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly embedFactory: DiscordEmbedFactory,
    private readonly channelBindingsService: ChannelBindingsService,
    private readonly settingsService: SettingsService,
  ) {
    this.startFlushTimer();
  }

  /**
   * Post the initial spawn notification embed.
   */
  async notifySpawn(
    eventId: number,
    bindingId: string,
    event: { id: number; title: string; gameName?: string },
    participants: Array<{ discordUserId: string; discordUsername: string }>,
  ): Promise<void> {
    const channelId = await this.resolveNotificationChannel(bindingId);
    if (!channelId) return;

    const context = await this.buildContext();
    const { embed, row } = this.embedFactory.buildAdHocSpawnEmbed(
      event,
      participants,
      context,
    );

    try {
      const message = await this.clientService.sendEmbed(channelId, embed, row);
      if (message) {
        this.messageIds.set(eventId, {
          channelId,
          messageId: message.id,
        });
      }
    } catch (err) {
      this.logger.error(
        `Failed to send ad-hoc spawn notification for event ${eventId}: ${err}`,
      );
    }
  }

  /**
   * Queue an update for batched flush (edit-in-place).
   */
  queueUpdate(eventId: number, bindingId: string): void {
    this.pendingUpdates.set(eventId, { eventId, bindingId });
  }

  /**
   * Post the final completion summary embed.
   */
  async notifyCompleted(
    eventId: number,
    bindingId: string,
    event: {
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
    const channelId = await this.resolveNotificationChannel(bindingId);
    if (!channelId) return;

    const context = await this.buildContext();
    const { embed, row } = this.embedFactory.buildAdHocCompletedEmbed(
      event,
      participants,
      context,
    );

    try {
      await this.clientService.sendEmbed(channelId, embed, row);
    } catch (err) {
      this.logger.error(
        `Failed to send ad-hoc completion for event ${eventId}: ${err}`,
      );
    }

    // Clean up tracked message
    this.messageIds.delete(eventId);
    this.pendingUpdates.delete(eventId);
  }

  /**
   * Flush pending updates — edit-in-place the tracked messages.
   */
  private async flushUpdates(): Promise<void> {
    if (this.pendingUpdates.size === 0) return;

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
  }

  private async processUpdate(update: PendingUpdate): Promise<void> {
    const tracked = this.messageIds.get(update.eventId);
    if (!tracked) return;

    // Fetch current participants
    const rows = await this.db
      .select()
      .from(schema.adHocParticipants)
      .where(eq(schema.adHocParticipants.eventId, update.eventId));

    const [event] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, update.eventId))
      .limit(1);

    if (!event) return;

    // Resolve game name
    let gameName: string | undefined;
    if (event.gameId) {
      const [game] = await this.db
        .select({ name: schema.games.name })
        .from(schema.games)
        .where(eq(schema.games.id, event.gameId))
        .limit(1);
      if (game) gameName = game.name;
    }

    const participants = rows.map((r) => ({
      discordUserId: r.discordUserId,
      discordUsername: r.discordUsername,
      isActive: !r.leftAt,
    }));

    const context = await this.buildContext();
    const { embed, row } = this.embedFactory.buildAdHocUpdateEmbed(
      {
        id: event.id,
        title: event.title,
        gameName,
      },
      participants,
      context,
    );

    try {
      await this.clientService.editEmbed(
        tracked.channelId,
        tracked.messageId,
        embed,
        row,
      );
    } catch (err) {
      this.logger.error(
        `Failed to edit ad-hoc embed for event ${update.eventId}: ${err}`,
      );
      // Remove tracked message if edit fails (message may have been deleted)
      this.messageIds.delete(update.eventId);
    }
  }

  /**
   * Resolve the notification channel for a binding.
   */
  private async resolveNotificationChannel(
    bindingId: string,
  ): Promise<string | null> {
    const binding = await this.channelBindingsService.getBindingById(bindingId);
    if (!binding) return null;

    // Use configured notification channel, or fall back to default channel
    const config = binding.config as {
      notificationChannelId?: string;
    } | null;

    if (config?.notificationChannelId) {
      return config.notificationChannelId;
    }

    // Fall back to default bot channel
    return this.settingsService.getDiscordBotDefaultChannel();
  }

  private async buildContext(): Promise<EmbedContext> {
    const [branding, clientUrl, timezone] = await Promise.all([
      this.settingsService.getBranding(),
      this.settingsService.getClientUrl(),
      this.settingsService.getDefaultTimezone(),
    ]);
    return {
      communityName: branding.communityName,
      clientUrl,
      timezone,
    };
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flushUpdates().catch((err) => {
        this.logger.error(`Batch flush error: ${err}`);
      });
    }, BATCH_FLUSH_INTERVAL_MS);
  }
}

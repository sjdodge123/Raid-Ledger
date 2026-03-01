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
  type EmbedContext,
  type EmbedEventData,
} from './discord-embed.factory';
import { EMBED_STATES } from '../discord-bot.constants';
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
 *
 * Uses the standard buildEventEmbed() layout so ad-hoc embeds match
 * the look of scheduled event embeds (game cover art, roster, timestamps).
 */
@Injectable()
export class AdHocNotificationService implements OnModuleDestroy {
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

  /** Guard against concurrent flushes */
  private flushing = false;

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

  onModuleDestroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
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
    const embedData = await this.buildEmbedEventData(
      eventId,
      participants.map((p) => ({
        discordUserId: p.discordUserId,
        discordUsername: p.discordUsername,
        isActive: true,
      })),
    );

    if (!embedData) return;

    const { embed, row } = this.embedFactory.buildEventEmbed(
      embedData,
      context,
      { state: EMBED_STATES.LIVE, buttons: 'view' },
    );

    try {
      const message = await this.clientService.sendEmbed(channelId, embed, row);
      if (message) {
        this.messageIds.set(eventId, {
          channelId,
          messageId: message.id,
        });

        // ROK-593: Insert discord_event_messages row so the embed scheduler
        // does not treat this ad-hoc event as "unposted" and create a duplicate.
        const guildId = this.clientService.getGuildId();
        if (guildId) {
          await this.db.insert(schema.discordEventMessages).values({
            eventId,
            guildId,
            channelId,
            messageId: message.id,
            embedState: EMBED_STATES.LIVE,
          });
        }
      } else {
        this.logger.warn(
          `sendEmbed returned no message for event ${eventId} — edit-in-place updates disabled`,
        );
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
    const embedData = await this.buildEmbedEventData(
      eventId,
      participants.map((p) => ({
        discordUserId: p.discordUserId,
        discordUsername: p.discordUsername,
        isActive: false,
      })),
    );

    if (!embedData) return;

    const { embed, row } = this.embedFactory.buildEventEmbed(
      embedData,
      context,
      { state: EMBED_STATES.COMPLETED, buttons: 'none' },
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

    // Fetch current participants
    const rows = await this.db
      .select()
      .from(schema.adHocParticipants)
      .where(eq(schema.adHocParticipants.eventId, update.eventId));

    const participants = rows.map((r) => ({
      discordUserId: r.discordUserId,
      discordUsername: r.discordUsername,
      isActive: !r.leftAt,
    }));

    const context = await this.buildContext();
    const embedData = await this.buildEmbedEventData(
      update.eventId,
      participants,
    );

    if (!embedData) return;

    const { embed, row } = this.embedFactory.buildEventEmbed(
      embedData,
      context,
      { state: EMBED_STATES.LIVE, buttons: 'view' },
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
   * Build a standard EmbedEventData from the DB for an ad-hoc event.
   * Fetches the event, game (with cover art), and formats participants
   * as signupMentions so the standard embed layout renders them.
   */
  private async buildEmbedEventData(
    eventId: number,
    participants: Array<{
      discordUserId: string;
      discordUsername: string;
      isActive: boolean;
    }>,
  ): Promise<EmbedEventData | null> {
    const [event] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    if (!event) return null;

    // Resolve game name + cover art
    let game: { name: string; coverUrl?: string | null } | null = null;
    if (event.gameId) {
      const [gameRow] = await this.db
        .select({ name: schema.games.name, coverUrl: schema.games.coverUrl })
        .from(schema.games)
        .where(eq(schema.games.id, event.gameId))
        .limit(1);
      if (gameRow) game = gameRow;
    }

    // Only count active participants for the signup count
    const activeCount = participants.filter((p) => p.isActive).length;

    return {
      id: event.id,
      title: event.title,
      startTime: event.duration[0].toISOString(),
      endTime: event.duration[1].toISOString(),
      signupCount: activeCount,
      maxAttendees: event.maxAttendees,
      slotConfig: event.slotConfig as EmbedEventData['slotConfig'],
      game: game ?? undefined,
      // Map participants as signup mentions for the roster section
      signupMentions: participants
        .filter((p) => p.isActive)
        .map((p) => ({
          discordId: p.discordUserId,
          username: p.discordUsername,
          role: null,
          preferredRoles: null,
        })),
    };
  }

  /**
   * Resolve the notification channel for a binding.
   * Priority: 1) explicit notificationChannelId in config,
   *           2) game-announcements binding for the same game,
   *           3) default bot channel.
   */
  private async resolveNotificationChannel(
    bindingId: string,
  ): Promise<string | null> {
    const binding = await this.channelBindingsService.getBindingById(bindingId);
    if (!binding) return null;

    // 1. Use configured notification channel if set
    const config = binding.config as {
      notificationChannelId?: string;
    } | null;

    if (config?.notificationChannelId) {
      return config.notificationChannelId;
    }

    // 2. Look for a game-announcements binding for the same game
    if (binding.gameId && binding.guildId) {
      const bindings = await this.channelBindingsService.getBindings(
        binding.guildId,
      );
      const announcementBinding = bindings.find(
        (b) =>
          b.bindingPurpose === 'game-announcements' &&
          b.gameId === binding.gameId,
      );
      if (announcementBinding) {
        return announcementBinding.channelId;
      }
    }

    // 3. Fall back to default bot channel
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

import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { eq, and, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot-client.service';
import {
  DiscordEmbedFactory,
  type EmbedEventData,
  type EmbedContext,
} from '../services/discord-embed.factory';
import { SettingsService } from '../../settings/settings.service';
import { EMBED_STATES, type EmbedState } from '../discord-bot.constants';
import {
  EMBED_SYNC_QUEUE,
  type EmbedSyncJobData,
} from '../queues/embed-sync.queue';

/** Two hours in milliseconds — threshold for IMMINENT state. */
const IMMINENT_THRESHOLD_MS = 2 * 60 * 60 * 1000;

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
  ) {
    super();
  }

  async process(job: Job<EmbedSyncJobData>): Promise<void> {
    const { eventId, reason } = job.data;

    this.logger.debug(
      `Processing embed sync for event ${eventId} (reason: ${reason})`,
    );

    if (!this.clientService.isConnected()) {
      this.logger.warn('Discord bot not connected, failing job for retry');
      throw new Error('Discord bot not connected');
    }

    const guildId = this.clientService.getGuildId();
    if (!guildId) {
      this.logger.warn('Bot not in any guild, skipping embed sync');
      return;
    }

    // Find the tracked Discord message for this event
    const [record] = await this.db
      .select()
      .from(schema.discordEventMessages)
      .where(
        and(
          eq(schema.discordEventMessages.eventId, eventId),
          eq(schema.discordEventMessages.guildId, guildId),
        ),
      )
      .limit(1);

    if (!record) {
      this.logger.debug(
        `No Discord message found for event ${eventId}, skipping`,
      );
      return;
    }

    // Don't update cancelled embeds
    if (record.embedState === EMBED_STATES.CANCELLED) {
      this.logger.debug(`Event ${eventId} embed is cancelled, skipping sync`);
      return;
    }

    // Fetch the event
    const [event] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    if (!event) {
      this.logger.warn(`Event ${eventId} not found, skipping embed sync`);
      return;
    }

    // If event was cancelled, let the event.cancelled handler deal with it
    if (event.cancelledAt) {
      return;
    }

    // Build embed event data with live roster information
    const eventData = await this.buildEventData(event);

    // Compute the new embed state
    const previousState = record.embedState as EmbedState;
    const newState = this.computeEmbedState(event, eventData);

    // Build and edit the embed
    try {
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

      // Update the embed state in the database
      await this.db
        .update(schema.discordEventMessages)
        .set({
          embedState: newState,
          updatedAt: new Date(),
        })
        .where(eq(schema.discordEventMessages.id, record.id));

      if (newState !== previousState) {
        this.logger.log(
          `Embed state transition for event ${eventId}: ${previousState} -> ${newState}`,
        );
      }

      this.logger.log(
        `Synced embed for event ${eventId} (state: ${newState}, reason: ${reason})`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to sync embed for event ${eventId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }

  /**
   * Build EmbedEventData with live roster/signup information.
   */
  private async buildEventData(
    event: typeof schema.events.$inferSelect,
  ): Promise<EmbedEventData> {
    // Get active signup count (exclude declined)
    const signupRows = await this.db
      .select({
        discordId: sql<
          string | null
        >`COALESCE(${schema.users.discordId}, ${schema.eventSignups.discordUserId})`,
        username: schema.users.username,
        role: schema.rosterAssignments.role,
        status: schema.eventSignups.status,
        preferredRoles: schema.eventSignups.preferredRoles,
      })
      .from(schema.eventSignups)
      .leftJoin(schema.users, eq(schema.eventSignups.userId, schema.users.id))
      .leftJoin(
        schema.rosterAssignments,
        eq(schema.eventSignups.id, schema.rosterAssignments.signupId),
      )
      .where(eq(schema.eventSignups.eventId, event.id));

    const activeSignups = signupRows.filter((r) => r.status !== 'declined');
    const signupCount = activeSignups.length;

    // Build role counts from roster assignments (exclude declined signups)
    const roleRows = await this.db
      .select({
        role: schema.rosterAssignments.role,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.rosterAssignments)
      .innerJoin(
        schema.eventSignups,
        eq(schema.rosterAssignments.signupId, schema.eventSignups.id),
      )
      .where(
        and(
          eq(schema.rosterAssignments.eventId, event.id),
          sql`${schema.eventSignups.status} != 'declined'`,
        ),
      )
      .groupBy(schema.rosterAssignments.role);

    const roleCounts: Record<string, number> = {};
    for (const row of roleRows) {
      if (row.role) roleCounts[row.role] = row.count;
    }

    const signupMentions = activeSignups
      .filter((r) => r.discordId !== null || r.username !== null)
      .map((r) => ({
        discordId: r.discordId,
        username: r.username,
        role: r.role ?? null,
        preferredRoles: r.preferredRoles,
      }));

    const eventData: EmbedEventData = {
      id: event.id,
      title: event.title,
      description: event.description,
      startTime: event.duration[0].toISOString(),
      endTime: event.duration[1].toISOString(),
      signupCount,
      maxAttendees: event.maxAttendees,
      slotConfig: event.slotConfig as EmbedEventData['slotConfig'],
      roleCounts,
      signupMentions,
    };

    // Resolve game info
    if (event.gameId) {
      const [game] = await this.db
        .select({ name: schema.games.name, coverUrl: schema.games.coverUrl })
        .from(schema.games)
        .where(eq(schema.games.id, event.gameId))
        .limit(1);
      if (game) {
        eventData.game = { name: game.name, coverUrl: game.coverUrl };
      }
    }

    return eventData;
  }

  /**
   * Compute the correct embed state based on event timing and roster fill.
   *
   * State transitions:
   * - POSTED/FILLING -> FULL: when signup count reaches maxAttendees
   * - FULL -> FILLING: when someone withdraws and count drops below max
   * - Any -> IMMINENT: when event is < 2 hours away
   * - IMMINENT -> LIVE: when event start time is reached
   * - LIVE -> COMPLETED: when event end time is reached
   */
  private computeEmbedState(
    event: typeof schema.events.$inferSelect,
    eventData: EmbedEventData,
  ): EmbedState {
    const now = Date.now();
    const startTime = event.duration[0].getTime();
    const endTime = event.duration[1].getTime();

    // Time-based states take priority (irreversible progression)
    if (now >= endTime) {
      return EMBED_STATES.COMPLETED;
    }

    if (now >= startTime) {
      return EMBED_STATES.LIVE;
    }

    if (startTime - now <= IMMINENT_THRESHOLD_MS) {
      return EMBED_STATES.IMMINENT;
    }

    // Capacity-based states
    if (event.maxAttendees && eventData.signupCount >= event.maxAttendees) {
      return EMBED_STATES.FULL;
    }

    // If event has signups, it's FILLING; otherwise POSTED
    if (eventData.signupCount > 0) {
      return EMBED_STATES.FILLING;
    }

    return EMBED_STATES.POSTED;
  }

  /**
   * Build shared embed context from settings.
   */
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
}

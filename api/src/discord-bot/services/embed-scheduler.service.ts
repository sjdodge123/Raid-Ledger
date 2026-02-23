import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { eq, sql, and, isNull } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { EmbedPosterService } from './embed-poster.service';
import {
  shouldPostEmbed,
  getLeadTimeFromRecurrence,
} from '../utils/embed-lead-time';

const STANDALONE_LEAD_TIME_MS = 6 * 24 * 60 * 60 * 1000; // 6 days

/**
 * Scheduled service that posts deferred Discord embeds for future events (ROK-434).
 *
 * Runs every 15 minutes and checks for events that:
 * 1. Are not cancelled
 * 2. Are in the future
 * 3. Do not yet have a discord_event_messages row
 * 4. Are within their lead-time posting window
 */
@Injectable()
export class EmbedSchedulerService {
  private readonly logger = new Logger(EmbedSchedulerService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly settingsService: SettingsService,
    private readonly cronJobService: CronJobService,
    private readonly embedPosterService: EmbedPosterService,
  ) {}

  @Cron('0 */15 * * * *', {
    name: 'EmbedSchedulerService_handleScheduledEmbeds',
  })
  async handleScheduledEmbeds(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'EmbedSchedulerService_handleScheduledEmbeds',
      async () => {
        await this.postDeferredEmbeds();
      },
    );
  }

  /**
   * Find future non-cancelled events without discord_event_messages rows
   * and post embeds for those within their lead-time window.
   */
  private async postDeferredEmbeds(): Promise<void> {
    const timezone = (await this.settingsService.getDefaultTimezone()) ?? 'UTC';

    // Find future events without embeds
    const now = new Date();
    const eventsWithoutEmbeds = await this.db
      .select({
        id: schema.events.id,
        duration: schema.events.duration,
        title: schema.events.title,
        description: schema.events.description,
        gameId: schema.events.gameId,
        recurrenceRule: schema.events.recurrenceRule,
        maxAttendees: schema.events.maxAttendees,
        slotConfig: schema.events.slotConfig,
      })
      .from(schema.events)
      .leftJoin(
        schema.discordEventMessages,
        eq(schema.events.id, schema.discordEventMessages.eventId),
      )
      .where(
        and(
          // Future events only
          sql`upper(${schema.events.duration}) > ${now.toISOString()}::timestamp`,
          // Not cancelled
          isNull(schema.events.cancelledAt),
          // No embed row yet
          isNull(schema.discordEventMessages.id),
        ),
      );

    if (eventsWithoutEmbeds.length === 0) {
      this.logger.debug('No deferred embeds to post');
      return;
    }

    let posted = 0;
    for (const event of eventsWithoutEmbeds) {
      const startTime = event.duration[0].toISOString();
      const endTime = event.duration[1].toISOString();

      // Determine lead time based on recurrence rule
      const recurrenceRule = event.recurrenceRule as {
        frequency: 'weekly' | 'biweekly' | 'monthly';
      } | null;
      const leadTimeMs =
        getLeadTimeFromRecurrence(recurrenceRule) ?? STANDALONE_LEAD_TIME_MS;

      if (!shouldPostEmbed(startTime, leadTimeMs, timezone, now)) {
        continue;
      }

      // Fetch game data if gameId is set
      let gameData: { name: string; coverUrl: string | null } | null = null;
      if (event.gameId) {
        const [game] = await this.db
          .select({ name: schema.games.name, coverUrl: schema.games.coverUrl })
          .from(schema.games)
          .where(eq(schema.games.id, event.gameId))
          .limit(1);
        if (game) {
          gameData = { name: game.name, coverUrl: game.coverUrl };
        }
      }

      // Build minimal event data for the embed
      const eventData = {
        id: event.id,
        title: event.title,
        description: event.description,
        startTime,
        endTime,
        signupCount: 0,
        maxAttendees: event.maxAttendees,
        slotConfig: event.slotConfig as {
          type?: string;
          tank?: number;
          healer?: number;
          dps?: number;
          flex?: number;
          player?: number;
          bench?: number;
        } | null,
        game: gameData,
      };

      const success = await this.embedPosterService.postEmbed(
        event.id,
        eventData,
        event.gameId,
      );

      if (success) {
        posted++;
        this.logger.log(
          `Scheduler posted deferred embed for event ${event.id} ("${event.title}")`,
        );
      }
    }

    if (posted > 0) {
      this.logger.log(`Scheduler posted ${posted} deferred embed(s)`);
    }
  }
}

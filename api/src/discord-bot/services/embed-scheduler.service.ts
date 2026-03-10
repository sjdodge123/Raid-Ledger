import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { eq, sql, and, isNull } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { EmbedPosterService } from './embed-poster.service';
import type { EmbedEventData } from './discord-embed.factory';
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

  @Cron('15 */15 * * * *', {
    name: 'EmbedSchedulerService_handleScheduledEmbeds',
  })
  async handleScheduledEmbeds(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'EmbedSchedulerService_handleScheduledEmbeds',
      () => this.postDeferredEmbeds(),
    );
  }

  /** Find future non-cancelled events without discord_event_messages rows. */
  private async postDeferredEmbeds(): Promise<void | false> {
    const timezone = (await this.settingsService.getDefaultTimezone()) ?? 'UTC';
    const now = new Date();
    const events = await this.queryEventsWithoutEmbeds(now);
    if (events.length === 0) {
      this.logger.debug('No deferred embeds to post');
      return false;
    }
    let posted = 0;
    for (const event of events) {
      const ok = await this.tryPostDeferredEmbed(event, timezone, now);
      if (ok) posted++;
    }
    if (posted > 0) {
      this.logger.log(`Scheduler posted ${posted} deferred embed(s)`);
    }
  }

  /** Query future events that have no embed row yet. */
  private async queryEventsWithoutEmbeds(now: Date): Promise<DeferredEvent[]> {
    return this.db
      .select({
        id: schema.events.id,
        duration: schema.events.duration,
        title: schema.events.title,
        description: schema.events.description,
        gameId: schema.events.gameId,
        recurrenceRule: schema.events.recurrenceRule,
        recurrenceGroupId: schema.events.recurrenceGroupId,
        notificationChannelOverride: schema.events.notificationChannelOverride,
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
          sql`upper(${schema.events.duration}) > ${now.toISOString()}::timestamp`,
          isNull(schema.events.cancelledAt),
          isNull(schema.discordEventMessages.id),
        ),
      );
  }

  /** Attempt to post a deferred embed for one event. */
  private async tryPostDeferredEmbed(
    event: DeferredEvent,
    timezone: string,
    now: Date,
  ): Promise<boolean> {
    const startTime = event.duration[0].toISOString();
    const recRule = event.recurrenceRule as RecurrenceFreq | null;
    const leadTimeMs =
      getLeadTimeFromRecurrence(recRule) ?? STANDALONE_LEAD_TIME_MS;
    if (!shouldPostEmbed(startTime, leadTimeMs, timezone, now)) return false;
    const gameData = await this.fetchGameData(event.gameId);
    const eventData = buildDeferredEventData(event, gameData);
    const success = await this.embedPosterService.postEmbed(
      event.id,
      eventData,
      event.gameId,
      event.recurrenceGroupId,
      event.notificationChannelOverride,
    );
    if (success) {
      this.logger.log(
        `Scheduler posted deferred embed for event ${event.id} ("${event.title}")`,
      );
    }
    return success;
  }

  /** Fetch game name/cover data for an event. */
  private async fetchGameData(
    gameId: number | null,
  ): Promise<{ name: string; coverUrl: string | null } | null> {
    if (!gameId) return null;
    const [game] = await this.db
      .select({ name: schema.games.name, coverUrl: schema.games.coverUrl })
      .from(schema.games)
      .where(eq(schema.games.id, gameId))
      .limit(1);
    return game ? { name: game.name, coverUrl: game.coverUrl } : null;
  }
}

type RecurrenceFreq = { frequency: 'weekly' | 'biweekly' | 'monthly' };

interface DeferredEvent {
  id: number;
  duration: Date[];
  title: string;
  description: string | null;
  gameId: number | null;
  recurrenceRule: unknown;
  recurrenceGroupId: string | null;
  notificationChannelOverride: string | null;
  maxAttendees: number | null;
  slotConfig: unknown;
}

/** Build embed event data from a deferred event row. */
function buildDeferredEventData(
  event: DeferredEvent,
  gameData: { name: string; coverUrl: string | null } | null,
): EmbedEventData {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    startTime: event.duration[0].toISOString(),
    endTime: event.duration[1].toISOString(),
    signupCount: 0,
    maxAttendees: event.maxAttendees,
    slotConfig: event.slotConfig as EmbedEventData['slotConfig'],
    game: gameData,
  };
}

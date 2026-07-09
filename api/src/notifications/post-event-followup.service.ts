import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { ActiveEventCacheService } from '../events/active-event-cache.service';
import { PostEventFollowupPromptService } from './post-event-followup-prompt.service';
import {
  findFollowupCandidateEvents,
  type FollowupCandidateEvent,
} from './post-event-followup.helpers';

const JOB_NAME = 'PostEventFollowupService_handlePostEventFollowups';
/** ~16 min lookback matches the M2 candidate window's lower bound. */
const POST_EVENT_WINDOW_MS = 16 * 60 * 1000;

/**
 * Post-event follow-up prompt cron (ROK-1371 M2). Every 60 s (offset :10 from
 * the PUG reminder's :5 to avoid same-tick contention) it detects scheduled
 * events whose EFFECTIVE end (`COALESCE(extended_until, upper(duration))`) fell
 * ~15 min ago and DMs the organizer a "Schedule a follow-up?" prompt exactly
 * once, gated by the `post_event_followup_sent` dedup row.
 */
@Injectable()
export class PostEventFollowupService {
  private readonly logger = new Logger(PostEventFollowupService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly cronJobService: CronJobService,
    private readonly promptService: PostEventFollowupPromptService,
    @Optional() private readonly eventCache: ActiveEventCacheService | null,
  ) {}

  /** Cron: DM organizers a follow-up prompt ~15 min after a scheduled event ends. */
  @Cron('10 */1 * * * *', { name: JOB_NAME })
  async handlePostEventFollowups(): Promise<void> {
    await this.cronJobService.executeWithTracking(JOB_NAME, () =>
      this.process(),
    );
  }

  /** Public entry for the DEMO test hook (mirrors ScheduledEventService). */
  runForTest(): Promise<void | false> {
    return this.process();
  }

  /** Core: find candidates, claim each atomically, prompt the organizer once. */
  private async process(): Promise<void | false> {
    if (!this.clientService.isConnected()) return false;
    if (this.eventCache) {
      const recent = this.eventCache.getRecentlyEndedEvents(
        new Date(),
        POST_EVENT_WINDOW_MS,
      );
      if (recent.length === 0) return false;
    }
    const candidates = await findFollowupCandidateEvents(this.db);
    if (candidates.length === 0) return false;
    for (const event of candidates) {
      await this.promptIfFreshlyClaimed(event);
    }
  }

  /** Insert the dedup row; only a fresh claim triggers the organizer prompt. */
  private async promptIfFreshlyClaimed(
    event: FollowupCandidateEvent,
  ): Promise<void> {
    const claimed = await this.db
      .insert(schema.postEventFollowupSent)
      .values({ eventId: event.id })
      .onConflictDoNothing({ target: schema.postEventFollowupSent.eventId })
      .returning();
    if (claimed.length === 0) return;
    await this.promptService.sendOrganizerPrompt(event);
  }
}

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
 * How long after an event is created a missing tracking row still counts as
 * "the initial post is in flight" rather than "this event has no embed".
 */
const POST_IN_FLIGHT_GRACE_MS = 60_000;

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
    if (active.length === 0) {
      await this.handleMissingTrackedMessage(records, eventId);
      return;
    }

    const event = await this.fetchEvent(eventId);
    if (!event || event.cancelledAt) return;
    // ROK-1447: Quick Play has its own compact layout and its own batched edit
    // loop (`AdHocNotificationService`). Tracked messages are looked up purely
    // by (eventId, guildId), so without this guard any enqueue that reached an
    // ad-hoc id would rebuild the card through the scheduled-event builder and
    // silently revert it — losing the badges and re-adding the button row.
    if (event.isAdHoc) return;
    // ROK-1370: while a reschedule poll is open the embed shows the
    // RESCHEDULING card — computeEmbedState can never return that state, so
    // any sync here (signup withdrawal, roster change, voice update) would
    // revert the card to a normal signup embed at the old time. Skip; the
    // lock-in / expiry UPDATED re-emit resumes syncing once the flag clears.
    if ((event.reschedulingPollId ?? null) !== null) return;

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

  /**
   * Decide whether "no active tracked message" is transient or permanent.
   *
   * ROK-1622: this used to be an unconditional `return`. The sync carries a
   * 2s coalescing delay, so when the initial post takes longer it runs first,
   * finds no row, and reports success — dropping the state correction, which
   * is how a freshly-created imminent event stayed cyan forever. Throwing
   * hands the job back to BullMQ's `attempts: 3` + exponential backoff.
   *
   * @param job - The running job, read for its attempt budget.
   * @param records - Every tracked row for this event, cancelled ones included.
   * @param eventId - The event being synced.
   */
  private async handleMissingTrackedMessage(
    records: (typeof schema.discordEventMessages.$inferSelect)[],
    eventId: number,
  ): Promise<void> {
    // Rows exist but every one is CANCELLED — the embed is deliberately dead.
    if (records.length > 0) return;
    const event = await this.fetchEvent(eventId);
    // No row is ever coming: deleted, cancelled, or a Quick Play card, which
    // `AdHocNotificationService` owns and never tracks here.
    if (!event || event.cancelledAt || event.isAdHoc) return;
    await this.refreshScheduledEventDescription(eventId, event);
    const ageMs = Date.now() - event.createdAt.getTime();
    if (ageMs > POST_IN_FLIGHT_GRACE_MS) {
      this.logger.debug(
        `Event ${eventId} has no tracked embed message and none is pending ` +
          `(created ${ageMs}ms ago); nothing to sync`,
      );
      return;
    }
    this.reportMissingRow(eventId, ageMs);
  }

  /**
   * Refresh the Discord scheduled event for an event that has no channel embed.
   *
   * ROK-1634: the refresh cannot sit behind the embed gate. Channel embeds are
   * deferred until `STANDALONE_LEAD_TIME_MS` (6 days) before start, but the
   * scheduled event is created the moment the event is, carrying "0 signed up".
   * Every sync on a further-out event bailed above, so the SE never learned
   * about a single signup until its embed finally posted.
   *
   * @param eventId - The event being synced.
   * @param event - The already-fetched, non-cancelled, non-ad-hoc event row.
   */
  private async refreshScheduledEventDescription(
    eventId: number,
    event: typeof schema.events.$inferSelect,
  ): Promise<void> {
    const eventData = await buildEventData(
      this.db,
      event,
      this.channelResolver,
    );
    // Same contract as `triggerSideEffects`: a Discord failure here must not
    // fail the sync job or hand BullMQ a retry.
    await this.scheduledEventService
      .updateDescription(eventId, eventData)
      .catch((err: unknown) => {
        this.logger.warn(
          `Failed to update scheduled event for ${eventId}: ${err instanceof Error ? err.message : 'Unknown'}`,
        );
      });
  }

  /** Throw to retry, unless this was the job's last attempt. */
  /**
   * Report a sync that arrived before the initial post's tracking row.
   *
   * ROK-1622 originally THREW here so BullMQ would retry. That was wrong, and
   * CI caught it: the queue is configured `attempts: 3` with
   * `backoff: exponential 5_000`, so a retry parks a job in `delayed` for
   * 5–10s — and `POST /admin/test/await-processing` drains with a 10s budget.
   * Every smoke test that creates an event and immediately awaits processing
   * started failing on `awaitDrained timed out ... delayed: 1`.
   *
   * The retry was belt-and-braces anyway. AC1 is the actual fix: the first
   * post now DERIVES its state, so a sync that loses this race no longer
   * leaves a wrong one behind — there is nothing for the retry to correct.
   * What the AC still requires is that this stops being SILENT, and a warning
   * does that without queue churn.
   */
  private reportMissingRow(eventId: number, ageMs: number): void {
    this.logger.warn(
      `Embed sync for event ${eventId} found no tracked message ` +
        `(created ${ageMs}ms ago) — the initial post has not written its row ` +
        `yet. Not retrying: the post derives its own state (ROK-1622 AC1), so ` +
        `there is no correction to lose.`,
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

  /**
   * Delete the recruitment bump message when the event becomes full (ROK-728).
   *
   * Targets `record.bumpChannelId` (the channel the bump was actually posted to)
   * when present, falling back to `record.channelId` for legacy rows that
   * predate the column (ROK-1335). The two diverge when channel bindings
   * changed between initial-embed-post and bump-post.
   */
  private async maybeDeleteBumpMessage(
    record: typeof schema.discordEventMessages.$inferSelect,
    newState: EmbedState,
    eventId: number,
  ): Promise<void> {
    if (newState !== EMBED_STATES.FULL || !record.bumpMessageId) return;
    const bumpChannelId = record.bumpChannelId ?? record.channelId;
    try {
      await this.clientService.deleteMessage(
        bumpChannelId,
        record.bumpMessageId,
      );
      await this.db
        .update(schema.discordEventMessages)
        .set({
          bumpMessageId: null,
          bumpChannelId: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.discordEventMessages.id, record.id));
      this.logger.log(`Deleted recruitment bump message for event ${eventId}`);
    } catch (err) {
      this.logger.warn(
        `Failed to delete bump message for event ${eventId} in channel ${bumpChannelId}: ${err instanceof Error ? err.message : 'Unknown'}`,
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

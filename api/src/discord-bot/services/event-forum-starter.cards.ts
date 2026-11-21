/**
 * ROK-2292 D2 — the signup card an event's forum post opens with, and the
 * `discord_event_messages` row that keeps it in sync.
 *
 * Both forum-post creators (the bot's event-planning post and the hub
 * webhook's event thread) post `{ content: '', embeds, components }` from
 * {@link EventForumStarterCards.build}, then {@link EventForumStarterCards.record}
 * the starter: `channel_id = message_id = thread id` (a forum post's starter
 * message id IS its thread id — see `event-message-rows.helpers.ts`), with
 * the same `embed_state` the embed-sync processor derives. From then on the
 * one updater edits it through `EventEmbedMessageEditor` like any copy.
 *
 * D8 (operator ruling 2026-11-21): the post is created when the event's
 * announcement embed is posted — `EmbedPosterService` emits
 * {@link EVENT_ANNOUNCEMENT_POSTED} and the forum module listens.
 */
import { EmbedSyncQueueService } from '../queues/embed-sync.queue';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { resolveGameHubLinkSafe } from '../channel-lifecycle/hub-link.resolver';
import { hubLinkPart } from '../channel-lifecycle/embed-hub-link.helpers';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { EMBED_STATES, type EmbedState } from '../discord-bot.constants';
import {
  buildEventData,
  computeEmbedState,
} from '../processors/embed-sync.helpers';
import { ChannelResolverService } from './channel-resolver.service';
import {
  DiscordEmbedFactory,
  embedComponents,
  type EmbedContext,
} from './discord-embed.factory';
import type { ForumStarterCard } from './event-embed-message.editor';

/** Emitted after an event's announcement embed is first posted (D8). */
export const EVENT_ANNOUNCEMENT_POSTED = 'discord.event-announcement.posted';

/** Payload of {@link EVENT_ANNOUNCEMENT_POSTED}. */
export interface EventAnnouncementPostedPayload {
  eventId: number;
}

/** A starter card plus the state its tracking row records. */
export interface EventStarterCard extends ForumStarterCard {
  state: EmbedState;
}

type EventRow = typeof schema.events.$inferSelect;

/** D7 — drop post `threadId`'s starter row(s); the sync stops editing it. */
export async function deleteForumStarterRows(
  db: Pick<PostgresJsDatabase<typeof schema>, 'delete'>,
  threadId: string,
): Promise<void> {
  const t = schema.discordEventMessages;
  await db
    .delete(t)
    .where(and(eq(t.channelId, threadId), eq(t.messageId, threadId)));
}

/**
 * Codex P2: an open reschedule poll holds the card at RESCHEDULING — the
 * state `event.listener` gives the announcement. `computeEmbedState` never
 * returns it, and the embed sync skips rescheduling events, so a post
 * created/restored/backfilled mid-poll would otherwise keep a live card.
 */
export function starterState(
  event: Pick<EventRow, 'reschedulingPollId'>,
  computed: EmbedState,
): EmbedState {
  if ((event.reschedulingPollId ?? null) !== null) {
    return EMBED_STATES.RESCHEDULING;
  }
  return computed;
}

@Injectable()
export class EventForumStarterCards {
  private readonly logger = new Logger(EventForumStarterCards.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly client: DiscordBotClientService,
    private readonly factory: DiscordEmbedFactory,
    private readonly channelResolver: ChannelResolverService,
    private readonly settings: SettingsService,
    private readonly sync: EmbedSyncQueueService,
  ) {}

  /**
   * The event's live signup card; null for a missing, cancelled or ad-hoc
   * event (those keep a text starter — Quick Play has its own card).
   */
  async build(eventId: number): Promise<EventStarterCard | null> {
    const [event] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);
    if (!event || event.cancelledAt !== null || event.isAdHoc) return null;
    const data = await buildEventData(
      this.db,
      event,
      this.channelResolver,
      this.settings,
    );
    const state = starterState(event, computeEmbedState(event, data));
    const context = await this.context(event);
    const built = this.factory.buildEventEmbed(data, context, { state });
    return { embeds: [built.embed], components: embedComponents(built), state };
  }

  /**
   * Track post `threadId`'s starter so the sync edits it. A repeat (lost
   * race, retried create) is a no-op; no-op while the bot has no guild.
   */
  async record(
    eventId: number,
    threadId: string,
    state: EmbedState,
  ): Promise<void> {
    const guildId = this.client.getGuildId();
    if (!guildId) return;
    await this.db
      .insert(schema.discordEventMessages)
      .values({
        eventId,
        guildId,
        channelId: threadId,
        messageId: threadId,
        embedState: state,
      })
      .onConflictDoNothing();
  }

  /**
   * A locked post reopened (rescheduled into the future): track its starter
   * again (D7 dropped the row) and re-sync the card it missed while closed.
   * False when the event has no card (missing, cancelled, ad-hoc).
   */
  async restore(eventId: number, threadId: string): Promise<boolean> {
    const card = await this.build(eventId);
    if (!card) return false;
    await this.record(eventId, threadId, card.state);
    await this.sync.enqueue(eventId, 'forum-starter-reopened');
    return true;
  }

  /** D7 — post `threadId` closed, moved or vanished: stop syncing it. */
  forget(threadId: string): Promise<void> {
    return deleteForumStarterRows(this.db, threadId);
  }

  private async context(event: EventRow): Promise<EmbedContext> {
    const [branding, clientUrl, timezone] = await Promise.all([
      this.settings.getBranding(),
      this.settings.getClientUrl(),
      this.settings.getDefaultTimezone(),
    ]);
    const hub = await resolveGameHubLinkSafe(
      this.db,
      { gameId: event.gameId, taggedGuildId: event.guildId, clientUrl },
      this.logger,
    );
    return {
      communityName: branding.communityName,
      clientUrl,
      timezone,
      ...hubLinkPart(hub),
    };
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CORE_PLUGIN_ID } from '@raid-ledger/contract';
import {
  EVENT_ANNOUNCEMENT_POSTED,
  type EventAnnouncementPostedPayload,
} from '../../../discord-bot/services/event-forum-starter.cards';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import { EventPlanningPostsService } from './event-planning-posts.service';
import { HubForumDiscordOutboundService } from './hub-forum-discord-outbound.service';
import { resolvePingThread } from './hub-forum-discord-signup-pings.target';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

/**
 * ROK-2292 D8 (operator ruling 2026-11-21: create on announce) — when an
 * event's announcement embed is posted, its forum post is created right
 * away, opening with the signup card: the hub's bound forum for a hub event,
 * else the event-planning registry post. Both creators are idempotent (the
 * hub claims its link row first, the registry insert has a unique key and a
 * lost race returns the winner), so the lazy creators — first signup line,
 * first reply, first vote — racing this one never make a second post. Part
 * of the Core forum sync; never throws into the poster.
 */
@Injectable()
export class HubForumDiscordAnnounceListener {
  /** Hub behaviour — read by the ownership guard's listener scan. */
  readonly hubBehaviour = 'hub-forum.discord-sync';
  readonly hubBehaviourKind = 'ingest-source';
  readonly ownerPluginId = CORE_PLUGIN_ID;
  private readonly logger = new Logger(HubForumDiscordAnnounceListener.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb,
    private readonly outbound: HubForumDiscordOutboundService,
    private readonly planning: EventPlanningPostsService,
  ) {}

  @OnEvent(EVENT_ANNOUNCEMENT_POSTED, { async: true })
  async onAnnounced(payload: EventAnnouncementPostedPayload): Promise<void> {
    try {
      await this.ensurePost(payload.eventId);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Forum post on announce of event ${payload.eventId}: ${why}`,
      );
    }
  }

  /** The event's post, created if it has none (no-op when it gets none). */
  private async ensurePost(eventId: number): Promise<void> {
    const ref = await resolvePingThread(this.db, eventId);
    if (!ref || ref.cancelled) return;
    if (ref.kind === 'hub') {
      const { guildId, threadId } = ref;
      await this.outbound.ensureEventPost({ guildId, threadId, create: true });
      return;
    }
    // A registry post that already exists (live or locked) is left alone.
    if (ref.post === null) await this.planning.ensureEventPost(eventId);
  }
}

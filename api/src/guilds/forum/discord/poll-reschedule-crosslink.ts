/**
 * ROK-2295 (Lead ruling Q1 b) — a reschedule poll's new Discord post and its
 * event's post link both ways, so the earlier chat is one click away: the
 * poll post gets "↩ Continues the chat from <#event>", the event post gets
 * "🗳 Rescheduling: vote on the new time in <#poll>". Bot lines, no pings.
 * Run once at poll-post creation (hub `send`, non-hub `ensurePollPost`);
 * a Redis NX key guards a retry. Best-effort: never throws. An event post
 * that is missing / unsent / locked / deleted skips the event side, and the
 * poll line links the event's page instead.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import { REDIS_CLIENT } from '../../../redis/redis.module';
import { getClientUrl } from '../../../settings/settings-bot.helpers';
import { SettingsService } from '../../../settings/settings.service';
import { findLiveEventThread } from '../event-discussion/event-discussion.queries';
import { findPollForSync } from '../subject-discussion/poll-discussion.queries';
import { rescheduledEvent } from '../subject-discussion/poll-discussion.sync';
import { findLivePlanningPost } from './event-planning-posts.queries';
import { findThreadLink, isUnsent } from './hub-forum-discord-links.queries';
import { HubForumDiscordOutboundGateway } from './hub-forum-discord-outbound.discord';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

/** Same lifetime as the voter once-keys: the creation moment is unique. */
export const CROSSLINK_TTL_SECONDS = 30 * 24 * 3600;

export function crosslinkKey(matchId: number, pollThreadId: string): string {
  return `hfd:resched-link:${matchId}:${pollThreadId}`;
}

/** Poll side: the event's post (`<#id>` is a clickable thread link). */
export function pollSideLine(eventThreadId: string): string {
  return `↩ Continues the chat from <#${eventThreadId}>`;
}

/** Poll side when the event has no open post: its page, or nothing. */
export function pollSideFallback(
  event: { id: number; title: string },
  clientUrl: string,
): string | null {
  if (!/^https?:\/\//i.test(clientUrl)) return null;
  const url = `${clientUrl.replace(/\/+$/, '')}/events/${event.id}`;
  return `↩ Continues the chat about ${event.title}: ${url}`;
}

/** Event side: the new poll's post. */
export function eventSideLine(pollThreadId: string): string {
  return `🗳 Rescheduling: vote on the new time in <#${pollThreadId}>`;
}

/** The event's open Discord post (hub link first, then registry), or null. */
export async function findOpenEventPostId(
  db: ForumDiscordDb,
  eventId: number,
): Promise<string | null> {
  const thread = await findLiveEventThread(db, eventId);
  const link = thread ? await findThreadLink(db, thread.id) : null;
  if (link && !isUnsent(link) && !link.discordDeletedAt) {
    return link.discordLockedAt ? null : link.discordThreadId;
  }
  const post = await findLivePlanningPost(db, 'event', eventId);
  return post && post.discordLockedAt === null ? post.discordThreadId : null;
}

@Injectable()
export class PollRescheduleCrosslink {
  private readonly logger = new Logger(PollRescheduleCrosslink.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb,
    private readonly gateway: HubForumDiscordOutboundGateway,
    private readonly settings: SettingsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Link a just-created poll post with its event's post. Never throws. */
  async linkPollPost(matchId: number, pollThreadId: string): Promise<void> {
    try {
      await this.link(matchId, pollThreadId);
    } catch (err) {
      this.warn(`poll ${matchId}`, err);
    }
  }

  private async link(matchId: number, pollThreadId: string): Promise<void> {
    const poll = await findPollForSync(this.db, matchId);
    const event = poll ? rescheduledEvent(poll) : null;
    if (!event) return;
    const key = crosslinkKey(matchId, pollThreadId);
    const ttl = CROSSLINK_TTL_SECONDS;
    if ((await this.redis.set(key, '1', 'EX', ttl, 'NX')) === null) return;
    const eventThreadId = await findOpenEventPostId(this.db, event.id);
    if (eventThreadId === null) {
      const url = await getClientUrl(this.settings);
      const line = pollSideFallback(event, url);
      if (line !== null) await this.send(pollThreadId, line, `poll ${matchId}`);
      return;
    }
    await this.send(pollThreadId, pollSideLine(eventThreadId), `poll ${matchId}`);
    await this.send(eventThreadId, eventSideLine(pollThreadId), `event ${event.id}`);
  }

  /** One side; a failure (locked 50083, deleted 10003, offline) is logged. */
  private async send(threadId: string, line: string, what: string) {
    try {
      await this.gateway.mention(threadId, line, []);
    } catch (err) {
      this.warn(what, err);
    }
  }

  private warn(what: string, err: unknown): void {
    const why = err instanceof Error ? err.message : String(err);
    this.logger.warn(`Reschedule cross-link for ${what} skipped: ${why}`);
  }
}

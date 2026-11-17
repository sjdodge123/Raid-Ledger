/**
 * ROK-2208 §5.7 item 3 (R11) — the inbound write gate for EVENT threads. A
 * Discord message in a post linked to an RL event thread is imported only
 * when its author may write there under ROK-2226 §6: a `signed_up` /
 * `tentative` signup on the event (bench included), found through
 * `users.discord_id` OR — OQ-10, ruled "yes" — an anonymous Discord signup
 * (`event_signups.discord_user_id`, no RL account; imported as a guest).
 * Anyone else stays on Discord only and gets ONE DM per (user, post): Redis
 * `SET NX` on `hfd:notice:<threadId>:<discordId>` for 30 days. Closed DMs
 * (50007) are silent. A read-only thread drops the message without a DM —
 * the lock sweep closes the post. A Discord user can never START an event
 * thread: inbound top-level posts are always imported as plain threads.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { EmbedBuilder } from 'discord.js';
import { and, eq, inArray } from 'drizzle-orm';
import type Redis from 'ioredis';
import { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { REDIS_CLIENT } from '../../../redis/redis.module';
import { getClientUrl } from '../../../settings/settings-bot.helpers';
import { SettingsService } from '../../../settings/settings.service';
import {
  WRITABLE_SIGNUP_STATUSES,
  isEventSignup,
} from '../event-discussion/event-discussion.queries';
import type { ForumLink } from './hub-forum-discord-links.queries';
import { userIdForDiscord } from './hub-forum-discord-inbound.writes';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

/** One notice per (Discord user, post) for 30 days. */
export const EVENT_NOTICE_TTL_SECONDS = 30 * 24 * 60 * 60;

/** The Redis "already told" key. */
export function eventNoticeKey(threadId: number, discordId: string): string {
  return `hfd:notice:${threadId}:${discordId}`;
}

/** The ruled DM copy. */
export function eventNoticeText(title: string, url: string): string {
  return `Only players signed up for ${title} can post in its discussion. Join Raid Ledger and sign up: ${url}`;
}

/** What the gate needs to know about one (thread, author). */
export interface EventGateFacts {
  eventId: number | null;
  eventTitle: string;
  writeClosesAt: Date | null;
  eventDetachedAt: Date | null;
  signedUp: boolean;
}

/** Facts for a thread with no event (or no row). */
const NO_EVENT = {
  eventId: null,
  eventTitle: '',
  writeClosesAt: null,
  eventDetachedAt: null,
} as const satisfies Omit<EventGateFacts, 'signedUp'>;

/** import = sync it; refuse = keep on Discord + DM; drop = keep, no DM. */
export type EventGateVerdict = 'import' | 'refuse' | 'drop';

/** §5.7 decision on plain facts (pure). */
export function eventGateVerdict(
  f: EventGateFacts,
  now: Date,
): EventGateVerdict {
  if (f.eventId === null) return 'import';
  const closes = f.writeClosesAt;
  const ended = closes !== null && closes.getTime() <= now.getTime();
  if (f.eventDetachedAt !== null || ended) return 'drop';
  return f.signedUp ? 'import' : 'refuse';
}

/** Discord's "Cannot send messages to this user" (DMs closed). */
function isClosedDms(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err
    ? err.code === 50007
    : false;
}

/** The R11 write gate. */
@Injectable()
export class HubForumDiscordEventGate {
  private readonly logger = new Logger(HubForumDiscordEventGate.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly client: DiscordBotClientService,
    private readonly settings: SettingsService,
  ) {}

  /** True when the message may be imported into the post's RL thread. */
  async admits(
    post: Pick<ForumLink, 'threadId'>,
    authorId: string,
    now = new Date(),
  ): Promise<boolean> {
    const facts = await this.loadFacts(post.threadId, authorId);
    const verdict = eventGateVerdict(facts, now);
    if (verdict === 'refuse' && facts.eventId !== null) {
      await this.noticeOnce(post.threadId, authorId, facts);
    }
    return verdict === 'import';
  }

  /** The thread's event columns + whether the author holds a writable signup. */
  async loadFacts(threadId: number, authorId: string): Promise<EventGateFacts> {
    const t = schema.hubForumThreads;
    const e = schema.events;
    const [row] = await this.db
      .select({
        eventId: t.eventId,
        eventTitle: e.title,
        writeClosesAt: t.writeClosesAt,
        eventDetachedAt: t.eventDetachedAt,
      })
      .from(t)
      .leftJoin(e, eq(e.id, t.eventId))
      .where(eq(t.id, threadId))
      .limit(1);
    if (!row || row.eventId === null) {
      return { ...NO_EVENT, signedUp: false };
    }
    const signedUp = await this.isSignedUp(row.eventId, authorId);
    return { ...row, eventTitle: row.eventTitle ?? 'this event', signedUp };
  }

  /** 2226 §6 via the RL account, else OQ-10's anonymous Discord signup. */
  private async isSignedUp(
    eventId: number,
    authorId: string,
  ): Promise<boolean> {
    const userId = await userIdForDiscord(this.db, authorId);
    if (userId !== null && (await isEventSignup(this.db, eventId, userId))) {
      return true;
    }
    const s = schema.eventSignups;
    const [anon] = await this.db
      .select({ id: s.id })
      .from(s)
      .where(
        and(
          eq(s.eventId, eventId),
          eq(s.discordUserId, authorId),
          inArray(s.status, [...WRITABLE_SIGNUP_STATUSES]),
        ),
      )
      .limit(1);
    return anon !== undefined;
  }

  /** Claim the Redis key; only the claimer DMs. Never throws. */
  private async noticeOnce(
    threadId: number,
    discordId: string,
    facts: EventGateFacts,
  ): Promise<void> {
    const key = eventNoticeKey(threadId, discordId);
    const ttl = EVENT_NOTICE_TTL_SECONDS;
    const claimed = await this.redis.set(key, '1', 'EX', ttl, 'NX');
    if (claimed !== 'OK') return;
    try {
      const url = `${await getClientUrl(this.settings)}/events/${facts.eventId}`;
      const embed = new EmbedBuilder()
        .setTitle(facts.eventTitle)
        .setDescription(eventNoticeText(facts.eventTitle, url))
        .setURL(url);
      await this.client.sendEmbedDM(discordId, embed);
    } catch (err) {
      if (isClosedDms(err)) return;
      const why = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Event thread ${threadId} notice DM failed: ${why}`);
    }
  }
}

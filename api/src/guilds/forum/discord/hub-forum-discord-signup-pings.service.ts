import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import { REDIS_CLIENT } from '../../../redis/redis.module';
import * as links from './hub-forum-discord-links.queries';
import { HubForumDiscordOutboundGateway } from './hub-forum-discord-outbound.discord';
import { HubForumDiscordOutboundService } from './hub-forum-discord-outbound.service';
import {
  diffPings,
  mentionMessages,
  pingedSetKey,
  signupPingDiscordIds,
  type SignupPingPlan,
} from './hub-forum-discord-signup-pings';
import {
  findBoundEventThread,
  listSignupPingRows,
  type PingThreadRef,
} from './hub-forum-discord-signup-pings.queries';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

/**
 * What one flush did. `offline` / `pending` mean "try again" (the processor
 * retries); the rest are final for this flush.
 */
export type SignupPingOutcome =
  'unbound' | 'unchanged' | 'offline' | 'closed' | 'pending' | 'pinged';

/** The pinged set outlives the event by a week, then Redis drops it. */
const SET_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * ROK-2260 — one debounced flush of an event's signups into its Discord post.
 * Diffs the eligible signups against the Redis "already pinged" set: new ones
 * get ONE roll-up bot @mention (which adds them to the post; the first one
 * creates the post — ruling 1), gone ones are removed silently (ruling 3).
 * Runs only for an event thread whose hub is bound to a Discord forum.
 */
@Injectable()
export class HubForumDiscordSignupPings {
  private readonly logger = new Logger(HubForumDiscordSignupPings.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb,
    private readonly outbound: HubForumDiscordOutboundService,
    private readonly gateway: HubForumDiscordOutboundGateway,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Flush one event; never pings a user twice for the same signup. */
  async flush(eventId: number): Promise<SignupPingOutcome> {
    const ref = await findBoundEventThread(this.db, eventId);
    if (!ref) return 'unbound';
    const rows = await listSignupPingRows(this.db, eventId);
    const key = pingedSetKey(eventId);
    const plan = diffPings(
      signupPingDiscordIds(rows),
      await this.redis.smembers(key),
    );
    if (plan.ping.length === 0 && plan.remove.length === 0) return 'unchanged';
    if (!this.gateway.isOnline()) return 'offline';
    const post = await this.postFor(ref, plan);
    if (post === null) return 'closed';
    if (links.isUnsent(post)) return 'pending';
    await this.ping(key, post.discordThreadId, plan.ping);
    await this.remove(key, post.discordThreadId, plan.remove);
    await this.redis.pexpireat(key, ref.endsAt.getTime() + SET_GRACE_MS);
    return 'pinged';
  }

  /**
   * The post to write in: created by the first ping (ruling 1); a removal
   * alone never creates one. Null when read-only, unbound, locked or deleted.
   */
  private async postFor(
    ref: PingThreadRef,
    plan: SignupPingPlan,
  ): Promise<links.ForumLink | null> {
    const { guildId, threadId } = ref;
    const post =
      plan.ping.length > 0
        ? await this.outbound.ensureEventPost({ guildId, threadId })
        : await links.findThreadLink(this.db, threadId);
    if (!post || post.discordDeletedAt || post.discordLockedAt) return null;
    return post;
  }

  /** One roll-up message per Discord-sized chunk; remembered as it lands. */
  private async ping(
    key: string,
    discordThreadId: string,
    userIds: string[],
  ): Promise<void> {
    for (const msg of mentionMessages(userIds)) {
      await this.gateway.mention(discordThreadId, msg.content, msg.userIds);
      await this.redis.sadd(key, ...msg.userIds);
    }
  }

  /** Ruling 3: out of the post silently; forgotten so a re-signup pings. */
  private async remove(
    key: string,
    discordThreadId: string,
    userIds: string[],
  ): Promise<void> {
    if (userIds.length === 0) return;
    const out = await this.gateway.removeThreadMembers(
      discordThreadId,
      userIds,
      (m) => this.logger.warn(m),
    );
    // Only the ones really out: a failed removal is retried next flush.
    if (out.length > 0) await this.redis.srem(key, ...out);
  }
}

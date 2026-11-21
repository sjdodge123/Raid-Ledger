import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import { REDIS_CLIENT } from '../../../redis/redis.module';
import { DiscordEmojiService } from '../../../discord-bot/services/discord-emoji.service';
import { EventPlanningPostsLockSweep } from './event-planning-posts.lock';
import { EventPlanningPostsService } from './event-planning-posts.service';
import { HubForumDiscordOutboundGateway } from './hub-forum-discord-outbound.discord';
import { HubForumDiscordOutboundService } from './hub-forum-discord-outbound.service';
import {
  DEL_IF_EQUALS,
  lineMessages,
  lineResyncKey,
  RESYNC_PENDING,
  resyncLandedValue,
  parsePosted,
  planLineFlush,
  postedValue,
  resyncStatusFields,
  seedFields,
  SEEDED_FIELD,
  type LineFlushPlan,
  type PostedMember,
} from './hub-forum-discord-signup-lines.flush';
import { signupLineEmoji } from './hub-forum-discord-signup-lines';
import {
  loadSignupLineStates,
  type SignupLineMember,
} from './hub-forum-discord-signup-lines.queries';
import type { PingThreadRef } from './hub-forum-discord-signup-pings.queries';
import {
  adoptScope,
  flushKeysFor,
  pingScope,
  resolveHubPost,
  resolvePingThread,
  resolvePlanningPost,
  type FlushKeys,
  writeUnlessGone,
  type PingPost,
} from './hub-forum-discord-signup-pings.target';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

/**
 * What one flush did. `offline` / `pending` / `incomplete` (a removal
 * Discord refused — Codex P2-2) mean "try again" (the processor retries);
 * the rest are final for this flush.
 */
export type SignupPingOutcome =
  | 'unbound'
  | 'unchanged'
  | 'offline'
  | 'closed'
  | 'pending'
  | 'incomplete'
  | 'pinged';

/** The pinged set outlives the event by a week, then Redis drops it. */
const SET_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** A resync flag no flush consumed (unbound event) is dropped after a day. */
const RESYNC_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * ROK-2260 / ROK-2271 — one debounced flush of an event's signups into its
 * Discord post: one line per member whose role, character or status changed
 * since the last posted line. A member's first line @mentions them (which
 * adds them to the post; the first one creates it — ruling 1); leavers are
 * named without a ping and removed from the post (ruling 3).
 * Runs for an event thread whose hub is bound to a Discord forum, and
 * (ROK-2272 S4b) for a non-hub event's Discord-only registry post.
 */
@Injectable()
export class HubForumDiscordSignupPings {
  private readonly logger = new Logger(HubForumDiscordSignupPings.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb,
    private readonly outbound: HubForumDiscordOutboundService,
    private readonly gateway: HubForumDiscordOutboundGateway,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly planning: EventPlanningPostsService,
    private readonly registryLock: EventPlanningPostsLockSweep,
    private readonly emoji: DiscordEmojiService,
  ) {}

  /** Flush one event; never pings a user twice for the same signup. */
  async flush(eventId: number): Promise<SignupPingOutcome> {
    const ref = await resolvePingThread(this.db, eventId);
    if (!ref) return 'unbound';
    const keys = flushKeysFor(eventId, pingScope(ref));
    const outcome = await this.flushBound(ref, eventId, keys);
    // Every bound flush (review r1 m2): a rescheduled event moves the expiry.
    const at = ref.endsAt.getTime() + SET_GRACE_MS;
    await this.redis.pexpireat(keys.pinged, at);
    await this.redis.pexpireat(keys.lines, at);
    return outcome;
  }

  /**
   * Fix round 2: set BEFORE the reset write. While pending, every flush
   * re-syncs silently but keeps the flag (the reset may not have landed).
   */
  async markResetPending(eventId: number): Promise<void> {
    await this.redis.set(
      lineResyncKey(eventId),
      RESYNC_PENDING,
      'PX',
      RESYNC_TTL_MS,
    );
  }

  /** The reset write threw: drop its pending flag (never a landed one). */
  async abortReset(eventId: number): Promise<void> {
    await this.redis.eval(
      DEL_IF_EQUALS,
      1,
      lineResyncKey(eventId),
      RESYNC_PENDING,
    );
  }

  /**
   * Review MAJOR-1: the reset landed. The next flush re-syncs the posted
   * statuses silently and takes the flag (see `takeLanded`).
   */
  async requestResync(eventId: number): Promise<void> {
    const value = resyncLandedValue(randomUUID());
    await this.redis.set(lineResyncKey(eventId), value, 'PX', RESYNC_TTL_MS);
  }

  /** A landed flag is used once; a newer reset's flag is left alone. */
  private async takeLanded(eventId: number, flag: string): Promise<void> {
    if (flag === RESYNC_PENDING) return;
    await this.redis.eval(DEL_IF_EQUALS, 1, lineResyncKey(eventId), flag);
  }

  /**
   * ROK-2271: diff each member's state against the last POSTED one, post
   * the lines (mentions only on a member's first line), then remove leavers.
   */
  private async flushBound(
    ref: PingThreadRef,
    eventId: number,
    keys: FlushKeys,
  ): Promise<SignupPingOutcome> {
    const { members, flags } = await this.readMembers(eventId);
    const pinged = await this.redis.smembers(keys.pinged);
    let posted = await this.postedOrSeed(keys.lines, pinged, members);
    if (flags.some((f) => f !== null)) {
      posted = await this.resync(keys.lines, posted, members);
      await this.takeIfStable(eventId, flags);
    }
    const plan = planLineFlush(
      pinged,
      posted,
      members,
      signupLineEmoji(this.emoji),
    );
    if (ref.cancelled) plan.lines = []; // review r1 m4: removals only
    if (plan.lines.length === 0 && plan.remove.length === 0) return 'unchanged';
    if (!this.gateway.isOnline()) return 'offline';
    const post = await this.postFor(ref, plan.lines.length > 0);
    if (typeof post === 'string') return post;
    await adoptScope(this.redis, eventId, keys, post.scope);
    return writeUnlessGone(this.db, post.scope, async () => {
      const id = post.discordThreadId;
      await this.post(keys, id, plan, members);
      const all = await this.remove(keys.pinged, id, plan.remove);
      return all ? 'pinged' : 'incomplete';
    });
  }

  /**
   * The signups, with the resync flag read before AND after them (Codex
   * P2-5): a reset that starts or lands in between makes the flush a
   * resync pass too.
   */
  private async readMembers(eventId: number): Promise<{
    members: Map<string, SignupLineMember>;
    flags: [string | null, string | null];
  }> {
    const before = await this.redis.get(lineResyncKey(eventId));
    const members = await loadSignupLineStates(this.db, eventId);
    const after = await this.redis.get(lineResyncKey(eventId));
    return { members, flags: [before, after] };
  }

  /**
   * Only a flag stable across the signup read is used up; a moved one is
   * left for the next flush, whose read surely sees that reset.
   */
  private async takeIfStable(
    eventId: number,
    [before, after]: [string | null, string | null],
  ): Promise<void> {
    if (before === null || before !== after) return;
    await this.takeLanded(eventId, before);
  }

  /** The last-posted states; seeds them (posting nothing) on first sight. */
  private async postedOrSeed(
    key: string,
    pinged: string[],
    members: Map<string, SignupLineMember>,
  ) {
    const hash = await this.redis.hgetall(key);
    if (hash[SEEDED_FIELD] !== undefined) return parsePosted(hash);
    const fields = seedFields(pinged, members);
    await this.redis.hset(key, fields);
    return parsePosted(fields);
  }

  /** Moves posted statuses to the reset ones; posts and pings nothing. */
  private async resync(
    key: string,
    posted: Map<string, PostedMember>,
    members: Map<string, SignupLineMember>,
  ): Promise<Map<string, PostedMember>> {
    const fields = resyncStatusFields(posted, members);
    if (Object.keys(fields).length === 0) return posted;
    await this.redis.hset(key, fields);
    return new Map([...posted, ...parsePosted(fields)]);
  }

  /** The post to write in (S4b: the one step the two targets differ on). */
  private postFor(ref: PingThreadRef, create: boolean): Promise<PingPost> {
    return ref.kind === 'hub'
      ? resolveHubPost(this.outbound, ref, create)
      : resolvePlanningPost(
          this.planning,
          (id) => this.registryLock.reopenIfPending(id),
          ref,
          create,
        );
  }

  /** One message per Discord-sized chunk; each remembered as it lands. */
  private async post(
    keys: FlushKeys,
    discordThreadId: string,
    plan: LineFlushPlan,
    members: Map<string, SignupLineMember>,
  ): Promise<void> {
    for (const msg of lineMessages(plan.lines)) {
      await this.gateway.mention(discordThreadId, msg.content, msg.userIds);
      if (msg.userIds.length > 0) {
        await this.redis.sadd(keys.pinged, ...msg.userIds);
      }
      await this.remember(keys.lines, msg.lines, members);
    }
  }

  /** Store each posted line's member state (gone = field dropped). */
  private async remember(
    key: string,
    posted: { discordId: string }[],
    members: Map<string, SignupLineMember>,
  ): Promise<void> {
    const fields: Record<string, string> = {};
    const gone: string[] = [];
    for (const { discordId } of posted) {
      const member = members.get(discordId);
      if (member) fields[discordId] = postedValue(member);
      else gone.push(discordId);
    }
    if (Object.keys(fields).length > 0) await this.redis.hset(key, fields);
    if (gone.length > 0) await this.redis.hdel(key, ...gone);
  }

  /**
   * Ruling 3: out of the post silently; forgotten so a re-signup pings.
   * False when any removal failed (those stay remembered for the retry).
   */
  private async remove(
    key: string,
    discordThreadId: string,
    userIds: string[],
  ): Promise<boolean> {
    if (userIds.length === 0) return true;
    const out = await this.gateway.removeThreadMembers(
      discordThreadId,
      userIds,
      (m) => this.logger.warn(m),
    );
    // Only the ones really out: a failed removal is retried next flush.
    if (out.length > 0) await this.redis.srem(key, ...out);
    const gone = new Set(out);
    return userIds.every((id) => gone.has(id));
  }
}

/**
 * ROK-2272 S4b — "find the Discord post for this event". A hub event writes
 * in its hub's bound forum (ROK-2260); a NON-HUB, non-ad-hoc event writes in
 * its Discord-only registry post in the event-planning forum. Everything
 * after "I have a Discord thread id" (lines, pings, removals, dedupe sets,
 * expiry) is the same flush for both; only resolving the post differs.
 */
import type Redis from 'ioredis';
import { markPlanningPostDeleted } from './event-planning-posts.queries';
import type { ReopenResult } from './event-planning-posts.lock';
import type { EventPlanningPostsService } from './event-planning-posts.service';
import * as links from './hub-forum-discord-links.queries';
import { isGone } from './hub-forum-discord-outbound.discord';
import type { HubForumDiscordOutboundService } from './hub-forum-discord-outbound.service';
import {
  postedLinesKey,
  SEEDED_FIELD,
} from './hub-forum-discord-signup-lines.flush';
import {
  pingedSetKey,
  type PingedSetScope,
} from './hub-forum-discord-signup-pings';
import {
  findBoundEventThread,
  findPlanningEventThread,
  type HubPingThreadRef,
  type PingThreadRef,
  type PlanningPingThreadRef,
} from './hub-forum-discord-signup-pings.queries';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

/** The two Redis keys of one event post. */
export interface FlushKeys {
  pinged: string;
  lines: string;
}

/** The post to write in, or why there is none (a `SignupPingOutcome`). */
export type PingPost =
  | { discordThreadId: string; scope: PingedSetScope }
  | 'closed'
  | 'pending'
  | 'offline';

/** Reopen a locked registry post whose close moved into the future. */
export type ReopenPlanningPost = (postId: number) => Promise<ReopenResult>;

/**
 * The event's ping target. The hub ALWAYS wins; a hub event whose hub has
 * no bound forum gets nothing (null), exactly as before S4b.
 */
export async function resolvePingThread(
  db: ForumDiscordDb,
  eventId: number,
): Promise<PingThreadRef | null> {
  const hub = await findBoundEventThread(db, eventId);
  if (hub) return hub;
  return (await findPlanningEventThread(db, eventId)) ?? null;
}

/** The dedupe-set scope of a target (hub form byte-identical to ROK-2260). */
export function pingScope(ref: PingThreadRef): PingedSetScope {
  if (ref.kind === 'hub') {
    return { guildId: ref.guildId, threadId: ref.threadId };
  }
  return { planningPostId: ref.post?.id ?? null };
}

export function flushKeysFor(
  eventId: number,
  scope: PingedSetScope,
): FlushKeys {
  return {
    pinged: pingedSetKey(eventId, scope),
    lines: postedLinesKey(eventId, scope),
  };
}

/**
 * The hub post: created by the first line (ruling 1); a removal alone never
 * creates one. Both go through the binding/stale gate (review r1 m3).
 * Closed when read-only, unbound, stale, locked or deleted.
 */
export async function resolveHubPost(
  outbound: HubForumDiscordOutboundService,
  ref: HubPingThreadRef,
  create: boolean,
): Promise<PingPost> {
  const { guildId, threadId } = ref;
  const post = await outbound.ensureEventPost({ guildId, threadId, create });
  if (!post || post.discordDeletedAt || post.discordLockedAt) return 'closed';
  if (links.isUnsent(post)) return 'pending';
  return { discordThreadId: post.discordThreadId, scope: pingScope(ref) };
}

/**
 * The registry post: an existing live one, else made by `ensureEventPost` —
 * only when there is a line to post. Closed when none can be made (no
 * forum, bot offline, event cancelled or past close). A locked post is
 * closed only when genuinely past its close; one rescheduled into the
 * future is reopened here (Codex P2-1), and a failed reopen is `'offline'`
 * (retried), never `'closed'` (terminal).
 */
export async function resolvePlanningPost(
  planning: EventPlanningPostsService,
  reopen: ReopenPlanningPost,
  ref: PlanningPingThreadRef,
  create: boolean,
): Promise<PingPost> {
  if (ref.post) {
    const { id, discordThreadId, locked } = ref.post;
    if (locked) {
      const state = await reopen(id);
      if (state === 'closed') return 'closed';
      if (state === 'failed') return 'offline';
    }
    return { discordThreadId, scope: { planningPostId: id } };
  }
  if (!create) return 'closed';
  const made = await planning.ensureEventPost(ref.eventId);
  if (!made) return 'closed';
  const scope = { planningPostId: made.postId };
  return { discordThreadId: made.discordThreadId, scope };
}

/**
 * ROK-2272 S4 review MAJOR-2: run the Discord writes into a post. When a
 * registry post's thread is gone (moderator delete), its row is marked
 * deleted and the flush is `'offline'` — a retried outcome (review round 2
 * MINOR-R2-1), so the queue's retry finds no live post, creates a fresh
 * one and posts the change that found the deletion. A hub post's gone
 * error is rethrown unchanged (its inbound delete handles it).
 */
export async function writeUnlessGone<T>(
  db: ForumDiscordDb,
  scope: PingedSetScope,
  write: () => Promise<T>,
): Promise<T | 'offline'> {
  try {
    return await write();
  } catch (err) {
    const postId = 'planningPostId' in scope ? scope.planningPostId : null;
    if (postId === null || !isGone(err)) throw err;
    await markPlanningPostDeleted(db, postId, new Date());
    return 'offline';
  }
}

/**
 * A just-created registry post: move `keys` (in place, so the caller's
 * expiry covers them) to the post's own scope, marked seeded so its next
 * flush diffs instead of re-seeding, and drop the pre-post keys. A no-op
 * when the scope did not change (every hub flush).
 */
export async function adoptScope(
  redis: Redis,
  eventId: number,
  keys: FlushKeys,
  scope: PingedSetScope,
): Promise<void> {
  const next = flushKeysFor(eventId, scope);
  if (next.lines === keys.lines) return;
  // Object form, as every other hset here (the test Redis has no 3-arg form).
  await redis.hset(next.lines, { [SEEDED_FIELD]: '1' });
  await redis.del(keys.pinged, keys.lines);
  Object.assign(keys, next);
}

/** For the DEMO_MODE probe: the target's Discord post id, once it exists. */
export async function pingPostThreadId(
  db: ForumDiscordDb,
  ref: PingThreadRef | null,
): Promise<string | null> {
  if (!ref) return null;
  if (ref.kind === 'planning') return ref.post?.discordThreadId ?? null;
  const post = await links.findThreadLink(db, ref.threadId);
  return post?.discordThreadId ?? null;
}

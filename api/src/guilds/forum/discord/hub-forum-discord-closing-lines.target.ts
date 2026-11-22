/**
 * ROK-2272 S10 — where a poll / lineup closing line goes, and the shared
 * once-claimed send. A hub subject posts into its hub thread's Discord post
 * (S8, unchanged); a non-hub subject posts into its registry planning post
 * (`event_planning_posts`). Never creates a post just to close it: no live
 * hub thread and no live registry row ⇒ no target.
 */
import type { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import {
  findLineupForSync,
  findLiveLineupThread,
} from '../subject-discussion/lineup-discussion.queries';
import {
  findLivePollThread,
  findPollForSync,
} from '../subject-discussion/poll-discussion.queries';
import {
  findLivePlanningPost,
  markPlanningPostDeleted,
} from './event-planning-posts.queries';
import {
  lineupOnPlanningPath,
  pollOnPlanningPath,
} from './event-planning-posts.subjects.rules';
import {
  findThreadLink,
  isCurrentBindingLink,
  isUnsent,
  markDeleted,
} from './hub-forum-discord-links.queries';
import {
  type HubForumDiscordOutboundGateway,
  isGone,
} from './hub-forum-discord-outbound.discord';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

/** A claimed once-key outlives any subject's end by far. */
export const CLOSING_ONCE_TTL_SECONDS = 30 * 24 * 3600;

/** Redis key that lets exactly one caller post a thread's closing line. */
export function closingOnceKey(threadId: number, onceKey: string): string {
  return `hfd:closing:${threadId}:${onceKey}`;
}

/** Same, for a registry planning post (S10). */
export function planningClosingOnceKey(
  postId: number,
  onceKey: string,
): string {
  return `hfd:closing:planning:${postId}:${onceKey}`;
}

/** Why a closing line did or did not go out. */
export type ClosingOutcome =
  'posted' | 'no-post' | 'closed-post' | 'offline' | 'already' | 'send-failed';

/** A hub thread (S8) or a registry planning post (S10). */
export type ClosingTarget =
  | { kind: 'hub'; threadId: number }
  | {
      kind: 'planning';
      postId: number;
      discordThreadId: string;
      closed: boolean;
    };

/** What the send arms need from the service. */
export interface ClosingSendDeps {
  db: ForumDiscordDb;
  redis: Redis;
  gateway: HubForumDiscordOutboundGateway;
  logger: Logger;
}

/**
 * The live hub thread first; else the live registry post — unless the
 * subject has since gone private or hub-tagged (R6: no line into a post
 * that should no longer exist); else null.
 */
export async function resolveClosingTarget(
  db: ForumDiscordDb,
  kind: 'poll' | 'lineup',
  id: number,
): Promise<ClosingTarget | null> {
  const thread =
    kind === 'poll'
      ? await findLivePollThread(db, id)
      : await findLiveLineupThread(db, id);
  if (thread) return { kind: 'hub', threadId: thread.id };
  const post = await findLivePlanningPost(db, kind, id);
  if (!post || !(await stillOnPlanningPath(db, kind, id))) return null;
  return {
    kind: 'planning',
    postId: post.id,
    discordThreadId: post.discordThreadId,
    closed: post.discordDeletedAt !== null || post.discordLockedAt !== null,
  };
}

/** A vanished subject row keeps its closing line (S10 behaviour). */
async function stillOnPlanningPath(
  db: ForumDiscordDb,
  kind: 'poll' | 'lineup',
  id: number,
): Promise<boolean> {
  if (kind === 'poll') {
    const poll = await findPollForSync(db, id);
    return !poll || pollOnPlanningPath(poll);
  }
  const lineup = await findLineupForSync(db, id);
  return !lineup || lineupOnPlanningPath(lineup);
}

/** The Redis once-key of a target. */
export function targetOnceKey(target: ClosingTarget, onceKey: string): string {
  return target.kind === 'hub'
    ? closingOnceKey(target.threadId, onceKey)
    : planningClosingOnceKey(target.postId, onceKey);
}

/** Log label naming the target (the hub label is S8's). */
export function targetLabel(target: ClosingTarget): string {
  return target.kind === 'hub'
    ? `thread #${target.threadId}`
    : `planning post #${target.postId}`;
}

/**
 * S8 hub arm: skips a thread with no post, an unsent one, a post from a
 * previous binding (D9), a deleted / locked one, or an offline bot.
 */
export async function postHubClosingLine(
  deps: ClosingSendDeps,
  threadId: number,
  text: string,
  onceKey: string,
): Promise<ClosingOutcome> {
  const link = await findThreadLink(deps.db, threadId);
  if (!link || isUnsent(link)) return 'no-post';
  if (!(await isCurrentBindingLink(deps.db, link))) return 'no-post';
  if (link.discordDeletedAt !== null || link.discordLockedAt !== null) {
    return 'closed-post';
  }
  const target: ClosingTarget = { kind: 'hub', threadId };
  const gone = () => markDeleted(deps.db, link.id, new Date());
  const line = { text, onceKey };
  return claimAndSend(deps, target, link.discordThreadId, line, gone);
}

/** S10 registry arm: skips a locked / deleted post or an offline bot. */
export async function postPlanningClosingLine(
  deps: ClosingSendDeps,
  target: Extract<ClosingTarget, { kind: 'planning' }>,
  text: string,
  onceKey: string,
): Promise<ClosingOutcome> {
  if (target.closed) return 'closed-post';
  const gone = () =>
    markPlanningPostDeleted(deps.db, target.postId, new Date());
  const line = { text, onceKey };
  return claimAndSend(deps, target, target.discordThreadId, line, gone);
}

/**
 * Only the caller that claims the once-key posts; a failed send releases
 * the key, logs one warning naming the target and the line, and reports
 * `send-failed` (best-effort, nothing retries it). A send that finds the
 * Discord post gone (deleted while the bot missed the inbound delete) also
 * marks it deleted via `markGone`, so later lines skip it as `closed-post`.
 */
async function claimAndSend(
  deps: ClosingSendDeps,
  target: ClosingTarget,
  discordThreadId: string,
  line: { text: string; onceKey: string },
  markGone: () => Promise<void>,
): Promise<ClosingOutcome> {
  const { text, onceKey } = line;
  if (!deps.gateway.isOnline()) return 'offline';
  const key = targetOnceKey(target, onceKey);
  const claimed = await deps.redis.set(
    key,
    '1',
    'EX',
    CLOSING_ONCE_TTL_SECONDS,
    'NX',
  );
  if (claimed === null) return 'already';
  try {
    await deps.gateway.mention(discordThreadId, text, []);
    return 'posted';
  } catch (err) {
    await deps.redis.del(key);
    if (isGone(err)) await markGone();
    const why = err instanceof Error ? err.message : String(err);
    deps.logger.warn(
      `Closing line ${onceKey} for ${targetLabel(target)} lost (not retried): ${why}`,
    );
    return 'send-failed';
  }
}

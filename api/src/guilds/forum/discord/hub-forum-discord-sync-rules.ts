/**
 * ROK-2208 §5.6 — the pure rules behind the reconnect reconcile and the
 * outbound retry sweep. No database, no discord.js: the services feed rows in.
 */
import type { ForumOp } from '../hub-forum.emit';
import {
  UNSENT_PREFIX,
  type ForumLink,
} from './hub-forum-discord-links.queries';

/** Most messages one reconnect replays per post (§5.6). */
export const MAX_BACKFILL_MESSAGES = 200;

/** The sweep stops retrying a link after this many failed attempts. */
export const RETRY_MAX_ATTEMPTS = 5;

/** A never-attempted `pending` row may still be mid-send in the listener. */
export const RETRY_GRACE_MS = 2 * 60_000;

type RetryOps = Record<'created' | 'updated' | 'deleted', ForumOp>;
const THREAD_OPS: RetryOps = {
  created: 'thread.created',
  updated: 'thread.updated',
  deleted: 'thread.deleted',
};
const REPLY_OPS: RetryOps = {
  created: 'reply.created',
  updated: 'reply.updated',
  deleted: 'reply.deleted',
};

/** The sweep's cadence; backoff steps are multiples of it. */
const SWEEP_MS = 5 * 60_000;

/**
 * Delay before the next attempt: the grace for a fresh row, then 5, 15, 35,
 * 75 min after `attempts` failures (5 min × (2^attempts − 1)).
 */
export function retryDelayMs(attempts: number): number {
  if (attempts <= 0) return RETRY_GRACE_MS;
  return SWEEP_MS * (2 ** attempts - 1);
}

/**
 * The link row has no last-attempt column (no schema change), so backoff is
 * measured from the last success, or from the claim for a never-sent row.
 */
export function isRetryDue(
  link: Pick<ForumLink, 'attempts' | 'syncedAt' | 'createdAt'>,
  now: Date,
): boolean {
  if (link.attempts >= RETRY_MAX_ATTEMPTS) return false;
  const base = link.syncedAt ?? link.createdAt;
  return now.getTime() - base.getTime() >= retryDelayMs(link.attempts);
}

/**
 * What re-drives a pending/failed RL-origin link: a placeholder id
 * (`rl:t:<id>`/`rl:r:<id>`) was never sent → create; a sent row whose RL row
 * is deleted → delete; else → edit. Null once Discord's side is gone.
 */
export function retryOp(
  link: Pick<ForumLink, 'kind' | 'discordMessageId' | 'discordDeletedAt'>,
  rowDeleted: boolean,
): ForumOp | null {
  if (link.discordDeletedAt !== null) return null;
  const ops = link.kind === 'thread' ? THREAD_OPS : REPLY_OPS;
  if (rowDeleted) return ops.deleted;
  if (link.discordMessageId.startsWith(UNSENT_PREFIX)) return ops.created;
  return ops.updated;
}

/**
 * §5.6: replay a post's messages `after` the newest linked snowflake. A post
 * with no real linked message replays from just before its starter (whose id
 * IS the thread id), so the starter imports first.
 */
export function replayAfter(
  threadId: string,
  linkedMessageIds: readonly string[],
): string {
  let newest: bigint | null = null;
  for (const id of linkedMessageIds) {
    if (id.startsWith(UNSENT_PREFIX)) continue;
    const n = BigInt(id);
    if (newest === null || n > newest) newest = n;
  }
  return (newest ?? BigInt(threadId) - 1n).toString();
}

/**
 * ROK-2301 retroactive rename. On every bot (re)connect the hub reconcile
 * brings each LIVE poll's Raid Ledger thread and its hub Discord post up to
 * the derived name (a follow-up poll reads `<game> — Poll (after <event>)`,
 * a pre-ROK-2295 standalone poll drops `Standalone Scheduling Poll`).
 *
 * Live: an attached poll thread (`match_id` set, not detached) that is still
 * writable or inside its close grace (`write_closes_at` null or later than
 * now). Its post is re-driven only when the link is sent, RL-origin, not
 * deleted and not locked. Both writes are idempotent: the Raid Ledger
 * refresh skips an unchanged row, and the gateway rename skips a matching
 * name before it spends the 2-per-10-minutes rename budget.
 */
import { and, desc, eq, gt, isNotNull, isNull, or } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import { syncEach } from './event-planning-posts.reconcile';
import {
  isEditableLink,
  type ForumLink,
} from './hub-forum-discord-links.queries';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

/** Poll threads per reconnect pass, newest first. */
export const POLL_TITLE_CATCH_UP_CAP = 100;

export interface LivePollThread {
  matchId: number;
  /** The thread's Discord post link, or null when it has none. */
  link: ForumLink | null;
}

/** Live poll threads (see the header), newest first, with their post link. */
export async function findLivePollThreads(
  db: ForumDiscordDb,
  now: Date,
  limit: number = POLL_TITLE_CATCH_UP_CAP,
): Promise<LivePollThread[]> {
  const t = schema.hubForumThreads;
  const k = schema.hubForumDiscordLinks;
  const rows = await db
    .select({ matchId: t.matchId, link: k })
    .from(t)
    .leftJoin(k, and(eq(k.threadId, t.id), eq(k.kind, 'thread')))
    .where(
      and(
        isNotNull(t.matchId),
        isNull(t.eventDetachedAt),
        or(isNull(t.writeClosesAt), gt(t.writeClosesAt, now)),
      ),
    )
    .orderBy(desc(t.id))
    .limit(limit);
  return rows.flatMap((r) =>
    r.matchId === null ? [] : [{ matchId: r.matchId, link: r.link }],
  );
}

/** A post the catch-up may rename: sent, RL-origin, not deleted or locked. */
export function renamablePost(link: ForumLink | null): link is ForumLink {
  return link !== null && isEditableLink(link) && link.discordLockedAt === null;
}

export interface PollTitleCatchUpDeps {
  /** The idempotent Raid Ledger thread reconciler. */
  syncThread: (matchId: number) => Promise<unknown>;
  /** The binding-checked `thread.updated` re-drive; null while offline. */
  redrive: ((link: ForumLink) => Promise<unknown>) | null;
  onError: (matchId: number, err: unknown) => void;
}

/**
 * Each poll once: the Raid Ledger thread first, then its post. One failing
 * poll is reported and the rest go on; returns how many completed.
 */
export function catchUpPollTitles(
  rows: readonly LivePollThread[],
  deps: PollTitleCatchUpDeps,
): Promise<number> {
  const byMatch = new Map(rows.map((r) => [r.matchId, r.link]));
  return syncEach(
    [...byMatch.keys()],
    async (matchId) => {
      await deps.syncThread(matchId);
      const link = byMatch.get(matchId) ?? null;
      if (deps.redrive && renamablePost(link)) await deps.redrive(link);
    },
    deps.onError,
  );
}

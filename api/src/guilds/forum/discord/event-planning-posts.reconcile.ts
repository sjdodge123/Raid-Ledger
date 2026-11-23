/**
 * ROK-2272 S4 — healing registry posts that missed a lifecycle change.
 * Codex P2-2: a retitle that arrived while the bot was offline is skipped
 * (`closes_at` is still re-derived — DB-only work never waits on Discord),
 * so every (re)connect re-syncs the live, unlocked event posts in one
 * bounded pass. Codex P2-3: an event changed or deleted while its post's
 * Discord create was in flight is reconciled once, right after the insert.
 */
import { and, asc, desc, eq, gt, isNull, or } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import type { EventPlanningPostSelect } from '../../../drizzle/schema/event-planning-posts';
import type { PlanningEventSource } from './event-planning-posts.queries';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

const posts = schema.eventPlanningPosts;
/** Posts per reconnect pass. */
export const RESYNC_CAP = 100;

/** Event ids of live, unlocked event posts with `id > afterId`, by id. */
export async function liveUnlockedEventSubjects(
  db: ForumDiscordDb,
  afterId: number,
  limit = RESYNC_CAP,
): Promise<number[]> {
  const rows = await db
    .select({ subjectId: posts.subjectId })
    .from(posts)
    .where(
      and(
        eq(posts.subjectKind, 'event'),
        gt(posts.id, afterId),
        isNull(posts.discordDeletedAt),
        isNull(posts.discordLockedAt),
      ),
    )
    .orderBy(asc(posts.id))
    .limit(limit);
  return rows.map((r) => r.subjectId);
}

/**
 * ROK-2301: live poll posts for the reconnect rename, newest first. Live =
 * not deleted, not locked, and still open (`closes_at` null or later than
 * now, so a recently decided poll inside its grace hour counts).
 */
export async function liveOpenPollPosts(
  db: ForumDiscordDb,
  now: Date,
  limit = RESYNC_CAP,
): Promise<EventPlanningPostSelect[]> {
  return db
    .select()
    .from(posts)
    .where(
      and(
        eq(posts.subjectKind, 'poll'),
        isNull(posts.discordDeletedAt),
        isNull(posts.discordLockedAt),
        or(isNull(posts.closesAt), gt(posts.closesAt, now)),
      ),
    )
    .orderBy(desc(posts.id))
    .limit(limit);
}

const time = (d: Date | null): number | null => d?.getTime() ?? null;

/** Whether the post-relevant fields differ (`now` null = event gone). */
export function planningEventChanged(
  was: PlanningEventSource,
  now: PlanningEventSource | null,
): boolean {
  if (now === null) return true;
  return (
    was.title !== now.title ||
    was.start.getTime() !== now.start.getTime() ||
    was.end.getTime() !== now.end.getTime() ||
    was.guildId !== now.guildId ||
    was.isAdHoc !== now.isAdHoc ||
    time(was.cancelledAt) !== time(now.cancelledAt)
  );
}

/** `sync` each id in turn; a failure is reported, never stops the rest. */
export async function syncEach(
  ids: readonly number[],
  sync: (id: number) => Promise<void>,
  onError: (id: number, err: unknown) => void,
): Promise<number> {
  let ok = 0;
  for (const id of ids) {
    try {
      await sync(id);
      ok += 1;
    } catch (err) {
      onError(id, err);
    }
  }
  return ok;
}

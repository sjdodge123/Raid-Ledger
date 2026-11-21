/**
 * ROK-2274 — the transaction behind RL signup lines: row-lock the event's
 * live hub thread, read the written states, let the caller plan, then insert
 * the line rows (`kind = 'signup_line'`, no author) and upsert / drop states.
 *
 * Lines are system text (D8): no `reply_count` / `last_activity_at` bump,
 * no `HUB_FORUM_CHANGED` emit (so never mirrored to Discord — sync loop 1),
 * no notification.
 */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import {
  loadSignupLineStatesByMemberKey,
  type KeyedSignupLineMember,
} from '../discord/hub-forum-discord-signup-lines.queries';
import type { ForumDiscordDb } from '../discord/hub-forum-discord.queries';
import {
  SEED_MEMBER_KEY,
  type RlLinePlan,
  type RlSignupLine,
  type WrittenLineState,
} from './event-discussion-signup-lines';

const threads = schema.hubForumThreads;
const replies = schema.hubForumReplies;
const states = schema.hubForumSignupLineStates;
const users = schema.users;
const events = schema.events;

/**
 * What one RL pass did. `no-thread`: no live hub thread for the event (a
 * non-hub / ad-hoc event — AC2); `cancelled`: nothing written (Discord
 * parity: a cancelled event lines nobody).
 */
export type RlLineOutcome =
  'no-thread' | 'cancelled' | 'seeded' | 'unchanged' | 'written';

/** Plans a flush from the written states (null = unseeded) and members. */
export type RlLinePlanner = (
  prior: ReadonlyMap<string, WrittenLineState> | null,
  members: Map<string, KeyedSignupLineMember>,
) => Promise<RlLinePlan>;

type Tx = Parameters<Parameters<ForumDiscordDb['transaction']>[0]>[0];

interface LiveThread {
  id: number;
  guildId: number;
  cancelled: boolean;
}

/** The event's live hub thread, row-locked so two flushes serialise. */
async function lockLiveThread(
  tx: Tx,
  eventId: number,
): Promise<LiveThread | null> {
  const [row] = await tx
    .select({
      id: threads.id,
      guildId: threads.guildId,
      cancelledAt: events.cancelledAt,
    })
    .from(threads)
    .innerJoin(events, eq(events.id, threads.eventId))
    .where(
      and(
        eq(threads.eventId, eventId),
        isNull(threads.eventDetachedAt),
        isNull(threads.deletedAt),
      ),
    )
    .orderBy(desc(threads.id))
    .limit(1)
    .for('update', { of: threads });
  if (!row) return null;
  return { id: row.id, guildId: row.guildId, cancelled: !!row.cancelledAt };
}

/** The written states, or null when the thread was never seeded. */
async function readPrior(
  tx: Tx,
  threadId: number,
): Promise<Map<string, WrittenLineState> | null> {
  const rows = await tx
    .select({ key: states.memberKey, state: states.state })
    .from(states)
    .where(eq(states.threadId, threadId));
  const out = new Map(rows.map((r) => [r.key, r.state]));
  return out.delete(SEED_MEMBER_KEY) ? out : null;
}

/** `subject_user_id`, null when that account is gone (FK-safe). */
function subjectOf(line: RlSignupLine) {
  const id = line.subjectUserId;
  if (id === null) return null;
  return sql<number>`(SELECT ${users.id} FROM ${users} WHERE ${users.id} = ${id})`;
}

/** One row per line, in plan order (same `created_at`; id orders them). */
async function insertLines(
  tx: Tx,
  thread: LiveThread,
  lines: readonly RlSignupLine[],
  now: Date,
): Promise<void> {
  if (lines.length === 0) return;
  await tx.insert(replies).values(
    lines.map((line) => ({
      threadId: thread.id,
      guildId: thread.guildId,
      kind: 'signup_line' as const,
      authorId: null,
      subjectUserId: subjectOf(line),
      body: line.body,
      createdAt: now,
      updatedAt: now,
    })),
  );
}

async function writeStates(
  tx: Tx,
  threadId: number,
  plan: RlLinePlan,
  now: Date,
): Promise<void> {
  const rows = [...plan.upsert].map(([memberKey, state]) => ({
    threadId,
    memberKey,
    state,
    writtenAt: now,
  }));
  if (rows.length > 0) {
    await tx
      .insert(states)
      .values(rows)
      .onConflictDoUpdate({
        target: [states.threadId, states.memberKey],
        set: { state: sql`excluded.state`, writtenAt: now },
      });
  }
  if (plan.drop.length === 0) return;
  await tx
    .delete(states)
    .where(
      and(eq(states.threadId, threadId), inArray(states.memberKey, plan.drop)),
    );
}

/** One RL pass for `eventId`, all-or-nothing. */
export async function writeRlSignupLines(
  db: ForumDiscordDb,
  eventId: number,
  now: Date,
  planner: RlLinePlanner,
): Promise<RlLineOutcome> {
  return db.transaction(async (tx) => {
    const thread = await lockLiveThread(tx, eventId);
    if (!thread) return 'no-thread';
    if (thread.cancelled) return 'cancelled';
    const prior = await readPrior(tx, thread.id);
    const members = await loadSignupLineStatesByMemberKey(tx, eventId);
    const plan = await planner(prior, members);
    await insertLines(tx, thread, plan.lines, now);
    await writeStates(tx, thread.id, plan, now);
    if (plan.seed) return 'seeded';
    return plan.lines.length > 0 ? 'written' : 'unchanged';
  });
}

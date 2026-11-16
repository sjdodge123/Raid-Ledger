/**
 * ROK-2226 L5 — the DEMO_MODE event-discussion fixture behind
 * `POST /admin/test/hubs/:id/event-discussion/seed`. On the hub it seeds:
 *   - an OPEN event (starts in 2 h) whose discussion thread carries three
 *     replies, with the member AND a non-member ("PUG", created here, keyed
 *     on the caller's tag) signed up; the reader (a member) is NOT signed up;
 *   - a LOCKED event (ended 27 h ago, so writes closed 3 h ago) whose thread
 *     carries one reply.
 * Threads come from the real reconciler (`syncEventDiscussion`), so the root
 * post, title and `write_closes_at` match what the lifecycle produces. A
 * re-call deletes the hub's earlier fixture events and their threads first.
 */
import { and, eq, inArray, like, or } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';
import * as schema from '../drizzle/schema';
import { findLiveEventThread } from '../guilds/forum/event-discussion/event-discussion.queries';
import { syncEventDiscussion } from '../guilds/forum/event-discussion/event-discussion.sync';
import { insertSeedReplies, type SeedActors } from './demo-test-hub-forum.rows';

type Db = PostgresJsDatabase<typeof schema>;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
export const OPEN_EVENT_PREFIX = 'Discussion night #';
export const LOCKED_EVENT_PREFIX = 'Discussion closed raid #';
/** The open thread's replies, oldest first (the card shows the newest 3). */
export const OPEN_REPLY_BODIES = [
  'Bring flasks and food buffs.',
  'I can tank if we are short.',
  'Happy to fill a healer spot.',
] as const;
export const LOCKED_REPLY_BODY = 'GG everyone, see you next week.';

/** Body: the signed-up member, the not-signed-up reader, and the caller's tag. */
export const EventDiscussionSeedSchema = z
  .object({
    memberUserId: z.number().int().positive(),
    readerUserId: z.number().int().positive(),
    tag: z
      .string()
      .regex(/^[a-z0-9-]{1,32}$/)
      .optional(),
  })
  .strict();
export type EventDiscussionSeedInput = z.infer<
  typeof EventDiscussionSeedSchema
>;

/** What the seed created, for smoke assertions and `test_url`s. */
export interface EventDiscussionSeedResult {
  guildId: number;
  eventId: number;
  threadId: number;
  replyIds: number[];
  lockedEventId: number;
  lockedThreadId: number;
  memberUserId: number;
  readerUserId: number;
  pugUserId: number;
}

/** Who the fixture writes as: admin (creator/leader), member, PUG, reader. */
export interface DiscussionSeedActors {
  guildId: number;
  adminId: number;
  memberId: number;
  readerId: number;
  pugId: number;
}

/** The hub's game (fixture events are on it). */
export async function hubGameId(db: Db, guildId: number): Promise<number> {
  const [row] = await db
    .select({ gameId: schema.guilds.gameId })
    .from(schema.guilds)
    .where(eq(schema.guilds.id, guildId))
    .limit(1);
  if (!row) throw new Error(`event-discussion seed: hub ${guildId} missing`);
  return row.gameId;
}

/**
 * The tag's PUG: a plain member-role user who joins no hub. Idempotent on a
 * deterministic `discord_id`; a lost concurrent insert re-reads the winner.
 */
export async function ensurePugUser(db: Db, tag?: string): Promise<number> {
  const key = tag ?? 'default';
  const discordId = `local:event-discussion-pug-${key}@seed.test`;
  const u = schema.users;
  const [made] = await db
    .insert(u)
    .values({
      username: `evdisc-pug-${key}`,
      discordId,
      role: 'member',
      guildMemberSeenAt: new Date(),
    })
    .onConflictDoNothing({ target: u.discordId })
    .returning({ id: u.id });
  if (made) return made.id;
  const [hit] = await db
    .select({ id: u.id })
    .from(u)
    .where(eq(u.discordId, discordId))
    .limit(1);
  if (!hit) throw new Error(`event-discussion seed: PUG ${key} missing`);
  return hit.id;
}

/** Delete the hub's earlier fixture events and their threads (no FK on `event_id`). */
export async function clearFixtureEvents(
  db: Db,
  guildId: number,
): Promise<void> {
  const ev = schema.events;
  const old = await db
    .select({ id: ev.id })
    .from(ev)
    .where(
      and(
        eq(ev.guildId, guildId),
        or(
          like(ev.title, `${OPEN_EVENT_PREFIX}%`),
          like(ev.title, `${LOCKED_EVENT_PREFIX}%`),
        ),
      ),
    );
  const ids = old.map((r) => r.id);
  if (ids.length === 0) return;
  const t = schema.hubForumThreads;
  await db.delete(t).where(inArray(t.eventId, ids));
  await db.delete(ev).where(inArray(ev.id, ids));
}

interface FixtureEvent {
  guildId: number;
  gameId: number;
  creatorId: number;
  title: string;
  start: Date;
  end: Date;
}

/** Insert one tagged event and let the reconciler attach its thread. */
async function insertTaggedEvent(
  db: Db,
  e: FixtureEvent,
  now: Date,
): Promise<{ eventId: number; threadId: number }> {
  const ev = schema.events;
  const [row] = await db
    .insert(ev)
    .values({
      title: e.title,
      gameId: e.gameId,
      creatorId: e.creatorId,
      guildId: e.guildId,
      isAdHoc: false,
      duration: [e.start, e.end] as [Date, Date],
    })
    .returning({ id: ev.id });
  if (!row) throw new Error(`event-discussion seed: ${e.title} not inserted`);
  await syncEventDiscussion(db, row.id, now);
  const thread = await findLiveEventThread(db, row.id);
  if (!thread) throw new Error(`event-discussion seed: no thread on ${row.id}`);
  return { eventId: row.id, threadId: thread.id };
}

/** `signed_up` rows for `userIds` on `eventId` (no roster slot). */
async function signUpAll(
  db: Db,
  eventId: number,
  userIds: number[],
): Promise<void> {
  await db
    .insert(schema.eventSignups)
    .values(
      userIds.map((userId) => ({ eventId, userId, status: 'signed_up' })),
    );
}

/** The open event: 3 replies (admin, member, PUG); member + PUG signed up. */
async function seedOpenEvent(
  db: Db,
  a: DiscussionSeedActors,
  gameId: number,
  now: Date,
): Promise<{ eventId: number; threadId: number; replyIds: number[] }> {
  const start = new Date(now.getTime() + 2 * HOUR_MS);
  const ids = await insertTaggedEvent(
    db,
    {
      guildId: a.guildId,
      gameId,
      creatorId: a.adminId,
      title: `${OPEN_EVENT_PREFIX}${a.guildId}`,
      start,
      end: new Date(start.getTime() + 3 * HOUR_MS),
    },
    now,
  );
  await signUpAll(db, ids.eventId, [a.memberId, a.pugId]);
  const authors = [a.adminId, a.memberId, a.pugId];
  const replyIds = await insertSeedReplies(
    db,
    rowActors(a),
    ids.threadId,
    OPEN_REPLY_BODIES.map((body, i) => ({
      authorId: authors[i] ?? a.adminId,
      body,
      at: new Date(now.getTime() - (30 - 10 * i) * MINUTE_MS),
    })),
  );
  return { ...ids, replyIds };
}

function rowActors(a: DiscussionSeedActors): SeedActors {
  return { guildId: a.guildId, leaderId: a.adminId, memberId: a.memberId };
}

/** The locked event: ended 27 h ago (writes closed 3 h ago), one reply. */
async function seedLockedEvent(
  db: Db,
  a: DiscussionSeedActors,
  gameId: number,
  now: Date,
): Promise<{ eventId: number; threadId: number }> {
  const end = new Date(now.getTime() - 27 * HOUR_MS);
  const ids = await insertTaggedEvent(
    db,
    {
      guildId: a.guildId,
      gameId,
      creatorId: a.adminId,
      title: `${LOCKED_EVENT_PREFIX}${a.guildId}`,
      start: new Date(end.getTime() - 3 * HOUR_MS),
      end,
    },
    now,
  );
  await signUpAll(db, ids.eventId, [a.memberId, a.pugId]);
  await insertSeedReplies(db, rowActors(a), ids.threadId, [
    { authorId: a.memberId, body: LOCKED_REPLY_BODY, at: end },
  ]);
  return ids;
}

/** Replace the hub's event-discussion fixture (see file docstring). */
export async function seedEventDiscussion(
  db: Db,
  a: DiscussionSeedActors,
  now: Date,
): Promise<EventDiscussionSeedResult> {
  const gameId = await hubGameId(db, a.guildId);
  await clearFixtureEvents(db, a.guildId);
  const open = await seedOpenEvent(db, a, gameId, now);
  const locked = await seedLockedEvent(db, a, gameId, now);
  return {
    guildId: a.guildId,
    ...open,
    lockedEventId: locked.eventId,
    lockedThreadId: locked.threadId,
    memberUserId: a.memberId,
    readerUserId: a.readerId,
    pugUserId: a.pugId,
  };
}

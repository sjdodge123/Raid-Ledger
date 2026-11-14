/**
 * ROK-1175 — the DEMO_MODE forum fixture behind
 * `POST /admin/test/hubs/:id/forum/seed`, for the fleet test plan and smoke
 * specs: a pinned leader thread, a member thread with replies (one removed
 * by a moderator), a member thread past the 24 h edit window, and optional
 * bulk threads for paging. A re-call replaces the hub's whole forum.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** Body: who plays the member, and how many filler threads to add. */
export const HubForumSeedSchema = z
  .object({
    memberUserId: z.number().int().positive(),
    bulk: z.number().int().min(0).max(1100).default(0),
  })
  .strict();

/** What the seed created, for `test_url`s and assertions. */
export interface HubForumSeedResult {
  guildId: number;
  pinnedThreadId: number;
  memberThreadId: number;
  staleThreadId: number;
  replyIds: number[];
  removedReplyId: number;
  bulk: number;
}

interface Actors {
  guildId: number;
  leaderId: number;
  memberId: number;
}

async function thread(
  db: Db,
  a: Actors,
  row: {
    authorId: number;
    title: string;
    body: string;
    at: Date;
    pinned?: boolean;
  },
): Promise<number> {
  const t = schema.hubForumThreads;
  const [out] = await db
    .insert(t)
    .values({
      guildId: a.guildId,
      authorId: row.authorId,
      title: row.title,
      body: row.body,
      createdAt: row.at,
      updatedAt: row.at,
      lastActivityAt: row.at,
      ...(row.pinned ? { pinnedAt: row.at, pinnedBy: a.leaderId } : {}),
    })
    .returning({ id: t.id });
  if (!out) throw new Error('forum seed: thread insert returned no row');
  return out.id;
}

/** Two replies on `threadId`; the second removed by the leader as moderator. */
async function replies(
  db: Db,
  a: Actors,
  threadId: number,
  now: Date,
): Promise<number[]> {
  const r = schema.hubForumReplies;
  const first = new Date(now.getTime() - 30 * MINUTE_MS);
  const rows = await db
    .insert(r)
    .values([
      {
        threadId,
        guildId: a.guildId,
        authorId: a.leaderId,
        body: 'Two healers, **one** tank.',
        createdAt: first,
        updatedAt: first,
      },
      {
        threadId,
        guildId: a.guildId,
        authorId: a.memberId,
        body: 'Off-topic rant',
        createdAt: now,
        updatedAt: now,
        deletedAt: now,
        deletedBy: a.leaderId,
        deletedAs: 'moderator',
      },
    ])
    .returning({ id: r.id });
  await db
    .update(schema.hubForumThreads)
    .set({ replyCount: 1, lastActivityAt: first })
    .where(eq(schema.hubForumThreads.id, threadId));
  return rows.map((row) => row.id);
}

async function bulkThreads(
  db: Db,
  a: Actors,
  n: number,
  now: Date,
): Promise<void> {
  if (n === 0) return;
  const rows = Array.from({ length: n }, (_, i) => {
    const at = new Date(now.getTime() - (48 * HOUR_MS + i * MINUTE_MS));
    return {
      guildId: a.guildId,
      authorId: a.memberId,
      title: `Filler thread ${i + 1}`,
      body: 'Paging filler.',
      createdAt: at,
      updatedAt: at,
      lastActivityAt: at,
    };
  });
  await db.insert(schema.hubForumThreads).values(rows);
}

/** Replace the hub's forum with the fixture (replies cascade with threads). */
export async function seedHubForum(
  db: Db,
  a: Actors,
  bulk: number,
  now: Date,
): Promise<HubForumSeedResult> {
  await db
    .delete(schema.hubForumThreads)
    .where(eq(schema.hubForumThreads.guildId, a.guildId));
  const pinnedThreadId = await thread(db, a, {
    authorId: a.leaderId,
    title: 'Read me first: forum rules',
    body: 'Be kind. Stay on topic.',
    at: new Date(now.getTime() - 3 * HOUR_MS),
    pinned: true,
  });
  const staleThreadId = await thread(db, a, {
    authorId: a.memberId,
    title: 'Old idea (edit window closed)',
    body: 'Posted yesterday.',
    at: new Date(now.getTime() - 25 * HOUR_MS),
  });
  const memberThreadId = await thread(db, a, {
    authorId: a.memberId,
    title: 'Raid comp for Tuesday',
    body: 'Who is bringing a **healer**?',
    at: new Date(now.getTime() - HOUR_MS),
  });
  const [kept, removed] = await replies(db, a, memberThreadId, now);
  if (kept === undefined || removed === undefined)
    throw new Error('forum seed: replies missing');
  await bulkThreads(db, a, bulk, now);
  return {
    guildId: a.guildId,
    pinnedThreadId,
    memberThreadId,
    staleThreadId,
    replyIds: [kept, removed],
    removedReplyId: removed,
    bulk,
  };
}

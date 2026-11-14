/**
 * ROK-1175 — row writers for the DEMO_MODE forum seed. Each reply insert
 * re-syncs the thread's `reply_count` (live replies) and `last_activity_at`
 * (newest reply, or the thread's own time) so the fixture matches what the
 * real write path would have produced.
 */
import { and, count, eq, isNull, max } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { HubForumDeleted } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;
/** A db or transaction handle. */
export type SeedDb = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

/** The hub and the two people the fixture writes as. */
export interface SeedActors {
  guildId: number;
  leaderId: number;
  memberId: number;
}

/** One seeded thread. */
export interface SeedThread {
  authorId: number;
  title: string;
  body: string;
  at: Date;
  pinned?: boolean;
  deleted?: { by: number; as: Exclude<HubForumDeleted, null> };
}

/** One seeded reply. */
export interface SeedReply {
  authorId: number;
  body: string;
  at: Date;
  deleted?: { by: number; as: Exclude<HubForumDeleted, null> };
}

function removal(at: Date, d: SeedReply['deleted']) {
  return d ? { deletedAt: at, deletedBy: d.by, deletedAs: d.as } : {};
}

export async function insertSeedThread(
  db: SeedDb,
  a: SeedActors,
  row: SeedThread,
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
      ...removal(row.at, row.deleted),
    })
    .returning({ id: t.id });
  if (!out) throw new Error('forum seed: thread insert returned no row');
  return out.id;
}

/** Insert `rows` on `threadId` (in order) and re-sync the thread counters. */
export async function insertSeedReplies(
  db: SeedDb,
  a: SeedActors,
  threadId: number,
  rows: readonly SeedReply[],
): Promise<number[]> {
  const r = schema.hubForumReplies;
  const out = await db
    .insert(r)
    .values(
      rows.map((row) => ({
        threadId,
        guildId: a.guildId,
        authorId: row.authorId,
        body: row.body,
        createdAt: row.at,
        updatedAt: row.at,
        ...removal(row.at, row.deleted),
      })),
    )
    .returning({ id: r.id });
  await syncThreadCounters(db, threadId);
  return out.map((row) => row.id);
}

async function syncThreadCounters(db: SeedDb, threadId: number) {
  const r = schema.hubForumReplies;
  const t = schema.hubForumThreads;
  const [live] = await db
    .select({ n: count() })
    .from(r)
    .where(and(eq(r.threadId, threadId), isNull(r.deletedAt)));
  const [latest] = await db
    .select({ at: max(r.createdAt) })
    .from(r)
    .where(and(eq(r.threadId, threadId), isNull(r.deletedAt)));
  await db
    .update(t)
    .set({
      replyCount: live?.n ?? 0,
      ...(latest?.at ? { lastActivityAt: latest.at } : {}),
    })
    .where(eq(t.id, threadId));
}

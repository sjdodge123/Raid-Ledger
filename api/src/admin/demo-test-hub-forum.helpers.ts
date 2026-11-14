/**
 * ROK-1175 — the DEMO_MODE forum fixture behind
 * `POST /admin/test/hubs/:id/forum/seed`. The base fixture (what the smoke
 * spec pins): a pinned leader thread, a member thread with replies (one
 * removed by a moderator), a member thread past the 24 h edit window, and
 * optional bulk threads for paging. `full: true` adds the fleet test plan's
 * extras (spec "Fleet test plan"): a second pin, a thread deleted by its
 * author that keeps a live reply, and the member thread grown to 30 replies
 * incl. one deleted by its author. A re-call replaces the hub's whole forum,
 * in one transaction.
 */
import { NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';
import * as schema from '../drizzle/schema';
import {
  seedFullExtras,
  type HubForumSeedExtras,
} from './demo-test-hub-forum.extras';
import {
  insertSeedReplies,
  insertSeedThread,
  type SeedActors,
  type SeedDb,
} from './demo-test-hub-forum.rows';

type Db = PostgresJsDatabase<typeof schema>;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** Body: who plays the member, filler threads, and the test-plan extras. */
export const HubForumSeedSchema = z
  .object({
    memberUserId: z.number().int().positive(),
    bulk: z.number().int().min(0).max(1100).default(0),
    full: z.boolean().default(false),
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
  /** Only with `full: true`. */
  extras: HubForumSeedExtras | null;
}

/**
 * The hub's id, 404 when unknown. Every hub kind has a forum — community
 * hubs included (the smoke spec seeds a `game_community` crew), so this does
 * NOT reuse `findHubOr404`, which refuses community hubs.
 */
export async function findForumHubOr404(
  db: Db,
  guildId: number,
): Promise<number> {
  const [row] = await db
    .select({ id: schema.guilds.id })
    .from(schema.guilds)
    .where(eq(schema.guilds.id, guildId))
    .limit(1);
  if (!row) throw new NotFoundException(`Guild ${guildId} not found`);
  return row.id;
}

/** Two replies on `threadId`; the second removed by the leader. */
async function baseReplies(
  db: SeedDb,
  a: SeedActors,
  threadId: number,
  now: Date,
): Promise<[number, number]> {
  const first = new Date(now.getTime() - 30 * MINUTE_MS);
  const [kept, removed] = await insertSeedReplies(db, a, threadId, [
    { authorId: a.leaderId, body: 'Two healers, **one** tank.', at: first },
    {
      authorId: a.memberId,
      body: 'Off-topic rant',
      at: now,
      deleted: { by: a.leaderId, as: 'moderator' },
    },
  ]);
  if (kept === undefined || removed === undefined)
    throw new Error('forum seed: replies missing');
  return [kept, removed];
}

async function bulkThreads(
  db: SeedDb,
  a: SeedActors,
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

/** The three base threads (pinned, stale, member). */
async function baseThreads(db: SeedDb, a: SeedActors, now: Date) {
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const pinnedThreadId = await insertSeedThread(db, a, {
    authorId: a.leaderId,
    title: 'Read me first: forum rules',
    body: 'Be kind. Stay on topic.',
    at: ago(3 * HOUR_MS),
    pinned: true,
  });
  const staleThreadId = await insertSeedThread(db, a, {
    authorId: a.memberId,
    title: 'Old idea (edit window closed)',
    body: 'Posted yesterday.',
    at: ago(25 * HOUR_MS),
  });
  const memberThreadId = await insertSeedThread(db, a, {
    authorId: a.memberId,
    title: 'Raid comp for Tuesday',
    body: 'Who is bringing a **healer**?',
    at: ago(HOUR_MS),
  });
  return { pinnedThreadId, staleThreadId, memberThreadId };
}

async function seedInTx(
  tx: SeedDb,
  a: SeedActors,
  opts: { bulk: number; full: boolean },
  now: Date,
): Promise<HubForumSeedResult> {
  await tx
    .delete(schema.hubForumThreads)
    .where(eq(schema.hubForumThreads.guildId, a.guildId));
  const ids = await baseThreads(tx, a, now);
  const [kept, removed] = await baseReplies(tx, a, ids.memberThreadId, now);
  const extras = opts.full ? await seedFullExtras(tx, a, ids, now) : null;
  await bulkThreads(tx, a, opts.bulk, now);
  return {
    guildId: a.guildId,
    ...ids,
    replyIds: [kept, removed],
    removedReplyId: removed,
    bulk: opts.bulk,
    extras,
  };
}

/** Replace the hub's forum with the fixture (replies cascade with threads). */
export async function seedHubForum(
  db: Db,
  a: SeedActors,
  opts: { bulk: number; full: boolean },
  now: Date,
): Promise<HubForumSeedResult> {
  return db.transaction((tx) => seedInTx(tx, a, opts, now));
}

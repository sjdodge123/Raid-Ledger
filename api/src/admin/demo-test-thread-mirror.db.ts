/**
 * ROK-1483 — the writes behind `POST /admin/test/thread-mirror`.
 *
 * Split from the controller so the controller is HTTP concerns only, and so
 * the binding write — the one that is easy to miss — is named and documented
 * in one place.
 */
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { SeedThreadMirrorBody } from './demo-test-thread-mirror.helpers';

/** Guild used when neither the body nor an existing group row names one. */
export const FALLBACK_SEED_GUILD_ID = '100000000000000001';

/** Drizzle handle carrying the full schema. */
export type SeedDb = PostgresJsDatabase<typeof schema>;

/** The game's live group row, if it already has one. */
async function findOpenGroupRow(
  db: SeedDb,
  gameId: number,
): Promise<{ id: string; guildId: string } | undefined> {
  const [row] = await db
    .select({
      id: schema.lfgGroupMessages.id,
      guildId: schema.lfgGroupMessages.guildId,
    })
    .from(schema.lfgGroupMessages)
    .where(
      and(
        eq(schema.lfgGroupMessages.gameId, gameId),
        eq(schema.lfgGroupMessages.state, 'open'),
      ),
    )
    .limit(1);
  return row;
}

/**
 * Write (a) — make the thread app-owned.
 *
 * A thread is app-owned ONLY by virtue of an `lfg_group_messages` row with
 * `post_kind = 'forum'` and a `thread_id` (`LfgGroupSurfaceResolver`). Without
 * it every read of the thread is a 403 and `LfgGroupDetail.threadId` stays
 * null, so the panel never mounts at all.
 *
 * @param db - Drizzle handle.
 * @param dto - The validated seam body.
 * @param gameId - The `lfg-group` surface id, as a number.
 * @returns The effective guild id — what the thread's deep link will carry.
 */
export async function bindThread(
  db: SeedDb,
  dto: SeedThreadMirrorBody,
  gameId: number,
): Promise<string> {
  const existing = await findOpenGroupRow(db, gameId);
  const guildId = dto.guildId ?? existing?.guildId ?? FALLBACK_SEED_GUILD_ID;
  const binding = {
    guildId,
    channelId: dto.threadId,
    threadId: dto.threadId,
    postKind: 'forum',
  };

  if (existing) {
    await db
      .update(schema.lfgGroupMessages)
      .set(binding)
      .where(eq(schema.lfgGroupMessages.id, existing.id));
  } else {
    await db
      .insert(schema.lfgGroupMessages)
      .values({ ...binding, gameId, messageId: dto.threadId, state: 'open' });
  }
  return guildId;
}

/**
 * Write (b), inverted — remove every mirrored row for the thread.
 *
 * A HARD delete, not the production soft delete: a soft-deleted row is
 * invisible to the read query but is still a `message_id` conflict, so
 * `insertMirroredMessages`' `onConflictDoNothing` would silently skip a
 * re-seed of the same id and the next assertion would face an empty panel it
 * did not ask for.
 *
 * @param db - Drizzle handle.
 * @param threadId - The thread to empty.
 * @returns How many rows were removed.
 */
export async function clearMirror(
  db: SeedDb,
  threadId: string,
): Promise<number> {
  const removed = await db
    .delete(schema.discordThreadMessages)
    .where(eq(schema.discordThreadMessages.threadId, threadId))
    .returning({ id: schema.discordThreadMessages.id });
  return removed.length;
}

/**
 * Teardown — drop the fabricated binding as well as the mirror rows.
 *
 * `uq_lfg_group_messages_game_open` allows exactly ONE open row per game, so a
 * seeded row left behind would collide with the next real LFM post for that
 * game (or make it edit a Discord message id that never existed). A smoke run
 * must be able to hand the game back exactly as it found it.
 *
 * Scoped to `(game_id, thread_id)` so it can only ever remove the row this
 * seam is responsible for.
 *
 * @param db - Drizzle handle.
 * @param threadId - The seeded thread.
 * @param gameId - The game the binding was written for.
 * @returns How many mirror rows were removed on the way out.
 */
export async function unbindThread(
  db: SeedDb,
  threadId: string,
  gameId: number,
): Promise<number> {
  const cleared = await clearMirror(db, threadId);
  await db
    .delete(schema.lfgGroupMessages)
    .where(
      and(
        eq(schema.lfgGroupMessages.gameId, gameId),
        eq(schema.lfgGroupMessages.threadId, threadId),
      ),
    );
  return cleared;
}

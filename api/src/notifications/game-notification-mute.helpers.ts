/**
 * Per-game notification mute gate (ROK-1797).
 *
 * One predicate, many readers (the ROK-1796 lesson): every per-game broadcast
 * recipient read (ROK-992, ROK-1229 …) MUST AND this. It is applied as an
 * OUTER filter on the user id, never folded into `interestedRowCondition` —
 * that condition also drives heart counts and search sort, and a mute must
 * not hide a heart. Muting removes the in-app row, push and DM alike, because
 * the user is dropped at recipient selection.
 */
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GameNotificationMuteListDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';

/**
 * SQL predicate: the user has NOT muted notifications for this game.
 *
 * @param gameId - Game the broadcast is about.
 * @param userCol - Outer-query user id column; defaults to `u.id`.
 * @returns A `NOT EXISTS` fragment to AND into a recipient `WHERE`.
 */
export function notGameMutedSql(
  gameId: number,
  userCol: SQL = sql.raw('u.id'),
): SQL {
  return sql`NOT EXISTS (
    SELECT 1 FROM game_notification_mutes gnm
    WHERE gnm.user_id = ${userCol} AND gnm.game_id = ${gameId}
  )`;
}

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Mute or unmute per-game notifications for a user. Idempotent both ways:
 * a repeat mute is a no-op insert, an unmute with no row deletes nothing.
 */
export async function setGameMute(
  db: Db,
  userId: number,
  gameId: number,
  muted: boolean,
): Promise<void> {
  const t = schema.gameNotificationMutes;
  if (muted) {
    await db.insert(t).values({ userId, gameId }).onConflictDoNothing();
    return;
  }
  await db.delete(t).where(and(eq(t.userId, userId), eq(t.gameId, gameId)));
}

/** Whether the user has muted per-game notifications for this game. */
export async function isGameMuted(
  db: Db,
  userId: number,
  gameId: number,
): Promise<boolean> {
  const t = schema.gameNotificationMutes;
  const rows = await db
    .select({ gameId: t.gameId })
    .from(t)
    .where(and(eq(t.userId, userId), eq(t.gameId, gameId)))
    .limit(1);
  return rows.length > 0;
}

/** The user's muted games, joined to `games`, ordered by name. */
export async function listGameMutes(
  db: Db,
  userId: number,
): Promise<GameNotificationMuteListDto> {
  const t = schema.gameNotificationMutes;
  const g = schema.games;
  const rows = await db
    .select({
      gameId: g.id,
      name: g.name,
      slug: g.slug,
      coverUrl: g.coverUrl,
      createdAt: t.createdAt,
    })
    .from(t)
    .innerJoin(g, eq(g.id, t.gameId))
    .where(eq(t.userId, userId))
    .orderBy(asc(g.name), asc(g.id));
  return {
    data: rows.map(({ createdAt, ...r }) => ({
      ...r,
      mutedAt: createdAt.toISOString(),
    })),
  };
}

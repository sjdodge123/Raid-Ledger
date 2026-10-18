/**
 * ROK-1843 — the ONE moderation lookup every Steam/ITAD discovery write path
 * consults before it creates, merges into, twins or returns a game row.
 *
 * Moderation (`hidden` / `banned`) is admin-only state. Discovery used to read
 * it per path and per key (slug here, itadGameId there), so each path had its
 * own gap: a slug-collision twin that ignored a banned itadGameId, a search
 * upsert that rewrote a hidden alternate-key match, a failed upsert that
 * surfaced the raw candidate. Centralising the lookup closes them together.
 */
import { eq, or, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { findGameByNormalizedName } from './igdb-name-dedup.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Every key a discovered game can collide with an existing row on. */
export interface ModerationKeys {
  slug?: string | null | undefined;
  itadGameId?: string | null | undefined;
  steamAppId?: number | null | undefined;
  igdbId?: number | null | undefined;
  /** Raw name; matched by normalized name (ROK-1113 dedup rules). */
  name?: string | null | undefined;
}

/** The moderated row a candidate collided with. */
export interface ModeratedMatch {
  id: number;
  hidden: boolean;
  banned: boolean;
}

/**
 * Return the most-moderated existing row (banned beats hidden) matching ANY
 * of `keys`, or null when every matching row is visible.
 *
 * Race-safety (Codex P2, ROK-1843): call this INSIDE the `withGameNameLock`
 * transaction, with its `tx`, before any write. The rows are read
 * `FOR UPDATE` (ordered by id, so two discoveries lock in the same order):
 * a ban committed before the read is seen (the locking read re-checks the
 * latest version), and a ban issued after it blocks on the row lock until
 * the discovery transaction commits — so the moderation state the write acts
 * on is the state that holds when it lands. The advisory name lock alone does
 * not cover this; admin moderation never takes it.
 */
export async function findModeratedMatch(
  tx: Db,
  keys: ModerationKeys,
): Promise<ModeratedMatch | null> {
  const conditions = await keyConditions(tx, keys);
  if (conditions.length === 0) return null;
  const g = schema.games;
  const rows = await tx
    .select({ id: g.id, hidden: g.hidden, banned: g.banned })
    .from(g)
    .where(or(...conditions))
    .orderBy(g.id)
    .for('update');
  return rows.find((r) => r.banned) ?? rows.find((r) => r.hidden) ?? null;
}

/** One equality condition per key that is present. */
async function keyConditions(tx: Db, keys: ModerationKeys): Promise<SQL[]> {
  const g = schema.games;
  const conditions: SQL[] = [];
  if (keys.slug) conditions.push(eq(g.slug, keys.slug));
  if (keys.itadGameId) conditions.push(eq(g.itadGameId, keys.itadGameId));
  if (keys.steamAppId != null) {
    conditions.push(eq(g.steamAppId, keys.steamAppId));
  }
  if (keys.igdbId != null) conditions.push(eq(g.igdbId, keys.igdbId));
  const byName = keys.name
    ? await findGameByNormalizedName(tx, keys.name)
    : null;
  if (byName && !isDistinctEdition(keys.igdbId, byName.igdbId)) {
    conditions.push(eq(g.id, byName.id));
  }
  return conditions;
}

/**
 * Codex r2 P2 (ROK-1843): a name match whose non-null igdbId differs from the
 * candidate's is a different edition (a remake, a sequel sharing a title), not
 * the same game. The dedup guards (`findByNormalizedName`, ROK-1113) already
 * keep such rows separate, so moderating one edition must not suppress the
 * other. Rows matched on a real key (slug, itadGameId, steamAppId, igdbId)
 * still count.
 */
function isDistinctEdition(
  candidate: number | null | undefined,
  matched: number | null | undefined,
): boolean {
  return candidate != null && matched != null && candidate !== matched;
}

/**
 * Advisory-lock class for the alternate-key moderation locks — disjoint from
 * `GAMES_NAME_LOCK_CLASS` so a hash collision with a name key can't deadlock.
 */
export const GAMES_MODERATION_KEY_LOCK_CLASS = 1843;

/**
 * Codex r2 P2 (ROK-1843): take a transaction-scoped advisory lock per
 * alternate key present (itadGameId, steamAppId, igdbId), ALWAYS in that
 * fixed order so two transactions never acquire them crosswise (no deadlock).
 *
 * The name lock only serialises discoveries for the SAME normalized name. Two
 * discoveries under different names that share an alternate key could both
 * probe `findModeratedMatch` before either commits, and the loser of the
 * unique-key collision would then insert a visible suffixed twin of a hidden
 * row. Call this inside the name-lock transaction BEFORE the probe: the second
 * discovery waits here until the first commits, then its probe sees the row.
 */
export async function lockModerationKeys(
  tx: Db,
  keys: ModerationKeys,
): Promise<void> {
  const lockKeys: string[] = [];
  if (keys.itadGameId) lockKeys.push(`game-mod:itad:${keys.itadGameId}`);
  if (keys.steamAppId != null) {
    lockKeys.push(`game-mod:steam:${keys.steamAppId}`);
  }
  if (keys.igdbId != null) lockKeys.push(`game-mod:igdb:${keys.igdbId}`);
  for (const key of lockKeys) {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${GAMES_MODERATION_KEY_LOCK_CLASS}::int4, hashtext(${key}))`,
    );
  }
}

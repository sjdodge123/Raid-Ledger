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
import { eq, or, type SQL } from 'drizzle-orm';
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
  if (byName) conditions.push(eq(g.id, byName.id));
  return conditions;
}

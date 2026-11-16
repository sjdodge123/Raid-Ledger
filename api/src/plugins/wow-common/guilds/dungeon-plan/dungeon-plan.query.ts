/**
 * ROK-2214 — the two reads the dungeon plan adds: the hub row with the guild's
 * faction column (the roster-insights hub row does not select it), and the
 * kept characters as readiness rows. Everything else reuses existing queries.
 */
import { eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../../drizzle/schema';
import type { ReadinessSignup } from '../../event-quest-readiness.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** The hub fields the plan reads. */
export interface PlanHubRow {
  kind: string;
  gameSlug: string | null;
  faction: string | null;
}

/** The hub's kind, game slug and faction column; null when it does not exist. */
export async function loadPlanHub(
  db: Db,
  guildId: number,
): Promise<PlanHubRow | null> {
  const g = schema.guilds;
  const [row] = await db
    .select({ kind: g.kind, gameSlug: schema.games.slug, faction: g.faction })
    .from(g)
    .leftJoin(schema.games, eq(schema.games.id, g.gameId))
    .where(eq(g.id, guildId))
    .limit(1);
  return row ?? null;
}

/**
 * The characters (≤5, already roster-checked) as readiness rows with their
 * owner, in the requested order. A character without an owner is skipped.
 */
export async function loadPlanSignups(
  db: Db,
  characterIds: readonly string[],
): Promise<ReadinessSignup[]> {
  if (characterIds.length === 0) return [];
  const c = schema.characters;
  const rows = await db
    .select({
      userId: schema.users.id,
      username: schema.users.username,
      characterId: c.id,
      characterName: c.name,
      charClass: c.class,
      charRace: c.race,
      charFaction: c.faction,
    })
    .from(c)
    .innerJoin(schema.users, eq(schema.users.id, c.userId))
    .where(inArray(c.id, [...characterIds]));
  const byId = new Map(rows.map((r) => [r.characterId, r]));
  return characterIds.flatMap((id) => byId.get(id) ?? []);
}

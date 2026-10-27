/**
 * ROK-1883 — the community-hubs seed's non-community hubs, so the game page's
 * one Hubs card shows every kind: a HIDDEN `game_server` hub (staff see it
 * flagged "Hidden"; members never do) and a `wow_guild` hub (members + staff
 * only). Plain `guilds` rows with no members; re-seeding deletes the previous
 * pair by name on the same game first (children cascade).
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { hubNameKey } from '../guilds/community/community-proposals.queries';

type Db = PostgresJsDatabase<typeof schema>;

export const SEED_OTHER_KIND_NAMES = {
  server: 'Seed Server',
  guild: 'Seed Guild',
} as const;

const KINDS = ['game_server', 'wow_guild'] as const;

/** Delete a previous run's seeded server + guild hubs on the game. */
export async function resetOtherKindHubs(
  db: Db,
  gameId: number,
): Promise<void> {
  const g = schema.guilds;
  const keys = Object.values(SEED_OTHER_KIND_NAMES).map(hubNameKey);
  await db
    .delete(g)
    .where(
      and(
        eq(g.gameId, gameId),
        inArray(g.kind, [...KINDS]),
        inArray(g.nameKey, keys),
      ),
    );
}

async function insertHub(
  db: Db,
  values: typeof schema.guilds.$inferInsert,
): Promise<number> {
  const [row] = await db
    .insert(schema.guilds)
    .values(values)
    .returning({ id: schema.guilds.id });
  if (!row) throw new Error(`seed hub ${values.name} insert returned no row`);
  return row.id;
}

/** Re-seed the hidden server hub + the WoW guild hub; returns their ids. */
export async function seedOtherKindHubs(
  db: Db,
  gameId: number,
): Promise<{ server: number; guild: number }> {
  await resetOtherKindHubs(db, gameId);
  const { server: s, guild: w } = SEED_OTHER_KIND_NAMES;
  const server = await insertHub(db, {
    gameId,
    kind: 'game_server',
    source: 'pelican',
    region: 'us',
    name: s,
    nameKey: hubNameKey(s),
    hiddenAt: new Date(),
  });
  const guild = await insertHub(db, {
    gameId,
    kind: 'wow_guild',
    source: 'addon_import',
    region: 'us',
    name: w,
    nameKey: hubNameKey(w),
    sourceName: w,
    lastSnapshotAt: new Date(),
  });
  return { server, guild };
}

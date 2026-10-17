/**
 * Shared loader for a character's LedgerLink `char` snapshot (ROK-1727 query,
 * extracted for ROK-1744 / ROK-1745). The games-slug join is the variant gate:
 * only characters on the WoW: Forever game return a row.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { WOW_FOREVER_GAME_SLUG } from './wow-forever-identity.helpers';

/** The snapshot columns the display resolvers read. */
export type ForeverCharSnapshot = Pick<
  schema.CharacterAddonSnapshotSelect,
  'data' | 'capturedAt'
>;

/** The `char` snapshot of a character on the Forever game, or null. */
export async function loadForeverCharSnapshot(
  db: PostgresJsDatabase<typeof schema>,
  characterId: string,
): Promise<ForeverCharSnapshot | null> {
  const snap = schema.characterAddonSnapshots;
  const [found] = await db
    .select({ data: snap.data, capturedAt: snap.capturedAt })
    .from(snap)
    .innerJoin(schema.characters, eq(schema.characters.id, snap.characterId))
    .innerJoin(schema.games, eq(schema.games.id, schema.characters.gameId))
    .where(
      and(
        eq(snap.characterId, characterId),
        eq(snap.section, 'char'),
        eq(schema.games.slug, WOW_FOREVER_GAME_SLUG),
      ),
    )
    .limit(1);
  return found ?? null;
}

/** Alias kept for ROK-1745 call sites that predate the rename. */
export type CharSnapshot = ForeverCharSnapshot;

/**
 * ROK-1748: batch variant — the `char` snapshots of Forever characters, keyed
 * by character id (one row per character+section, so no newest-pick needed).
 */
export async function loadForeverCharSnapshots(
  db: PostgresJsDatabase<typeof schema>,
  characterIds: string[],
): Promise<Map<string, CharSnapshot>> {
  if (characterIds.length === 0) return new Map();
  const snap = schema.characterAddonSnapshots;
  const rows = await db
    .select({ id: snap.characterId, data: snap.data, at: snap.capturedAt })
    .from(snap)
    .innerJoin(schema.characters, eq(schema.characters.id, snap.characterId))
    .innerJoin(schema.games, eq(schema.games.id, schema.characters.gameId))
    .where(
      and(
        inArray(snap.characterId, characterIds),
        eq(snap.section, 'char'),
        eq(schema.games.slug, WOW_FOREVER_GAME_SLUG),
      ),
    );
  return new Map(rows.map((r) => [r.id, { data: r.data, capturedAt: r.at }]));
}

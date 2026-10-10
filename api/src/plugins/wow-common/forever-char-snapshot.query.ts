/**
 * Shared loader for a WoW: Forever character's LedgerLink `char` snapshot
 * (extracted from ROK-1727's ForeverDisplayEquipmentService; reused by
 * ROK-1744 and ROK-1745).
 */
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { WOW_FOREVER_GAME_SLUG } from './wow-forever-identity.helpers';

/** The `data` + `capturedAt` slice of a `char` snapshot row. */
export type CharSnapshot = Pick<
  schema.CharacterAddonSnapshotSelect,
  'data' | 'capturedAt'
>;

/** The `char` snapshot of a character on the Forever game, if any. */
export async function loadForeverCharSnapshot(
  db: PostgresJsDatabase<typeof schema>,
  characterId: string,
): Promise<CharSnapshot | undefined> {
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
  return found;
}

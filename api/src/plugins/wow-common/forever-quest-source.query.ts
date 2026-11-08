/**
 * ROK-2109 (D5): one loader for every quest consumer — the LedgerLink `char`
 * snapshots plus the Armory `characters.armory_quests` column of Forever
 * characters, combined by {@link effectiveQuests}. The games-slug join is the
 * variant gate, as in `forever-char-snapshot.query.ts`.
 */
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { loadForeverCharSnapshots } from './forever-char-snapshot.query';
import {
  effectiveQuests,
  type EffectiveQuests,
} from './forever-quest-source.helpers';
import { WOW_FOREVER_GAME_SLUG } from './wow-forever-identity.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** `armory_quests` of the Forever characters among `ids` that have one. */
async function loadArmoryQuests(
  db: Db,
  ids: string[],
): Promise<Map<string, unknown>> {
  const c = schema.characters;
  const rows = await db
    .select({ id: c.id, quests: c.armoryQuests })
    .from(c)
    .innerJoin(schema.games, eq(schema.games.id, c.gameId))
    .where(
      and(
        inArray(c.id, ids),
        isNotNull(c.armoryQuests),
        eq(schema.games.slug, WOW_FOREVER_GAME_SLUG),
      ),
    );
  return new Map(rows.map((r) => [r.id, r.quests]));
}

/**
 * Effective quest data per Forever character id; characters with neither an
 * addon quests slice nor a valid Armory list are absent from the map.
 */
export async function loadForeverQuestSources(
  db: Db,
  characterIds: string[],
): Promise<Map<string, EffectiveQuests>> {
  const ids = [...new Set(characterIds)];
  if (ids.length === 0) return new Map();
  const [snapshots, armory] = await Promise.all([
    loadForeverCharSnapshots(db, ids),
    loadArmoryQuests(db, ids),
  ]);
  const out = new Map<string, EffectiveQuests>();
  for (const id of ids) {
    const eff = effectiveQuests(snapshots.get(id) ?? null, armory.get(id));
    if (eff) out.set(id, eff);
  }
  return out;
}

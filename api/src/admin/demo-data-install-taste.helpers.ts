/**
 * Install helpers for demo-mode taste-profile signal data (ROK-1083).
 * Persists weekly + daily game activity rollups and steam-library game
 * interests so the taste-profile pipelines derive varied intensity tiers
 * and vector titles across the demo population.
 */
import { eq } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { deriveArchetype } from '../taste-profile/archetype.helpers';
import type {
  GeneratedGameActivityRollup,
  GeneratedPlayhistoryInterest,
} from './demo-data-gen-taste-profile';

type Db = PostgresJsDatabase<typeof schema>;
type BatchInsert = (
  table: Parameters<Db['insert']>[0],
  rows: Record<string, unknown>[],
  onConflict?: 'doNothing',
) => Promise<void>;

type UserMap = Map<string, { id: number }>;
type GameMap = Map<number | null, number>;

function nonNull<T>(v: T | null): v is T {
  return v !== null;
}

/** Format as YYYY-MM-DD for drizzle's date column. */
function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Install weekly + daily activity rollups. Uses `doNothing` on conflict so
 * re-runs never double-count. Rows referring to missing users/games are
 * dropped silently — missing IGDB IDs happen when the demo game catalogue
 * hasn't been synced yet.
 */
export async function installGameActivityRollups(
  batchInsert: BatchInsert,
  userByName: UserMap,
  igdbIdsByDbId: GameMap,
  generated: GeneratedGameActivityRollup[],
): Promise<number> {
  const values = generated
    .map((row) => {
      const user = userByName.get(row.username);
      const gameId = igdbIdsByDbId.get(row.igdbId);
      if (!user || !gameId) return null;
      return {
        userId: user.id,
        gameId,
        period: row.period,
        periodStart: toDateString(row.periodStart),
        totalSeconds: row.totalSeconds,
      };
    })
    .filter(nonNull);
  if (values.length === 0) return 0;
  await batchInsert(schema.gameActivityRollups, values, 'doNothing');
  return values.length;
}

/**
 * Install steam-library flavoured game interests with playtime fields.
 * Dedupes by (userId, gameId, source) so the DB unique constraint is
 * respected on re-runs.
 */
export async function installPlayhistoryInterests(
  batchInsert: BatchInsert,
  userByName: UserMap,
  igdbIdsByDbId: GameMap,
  generated: GeneratedPlayhistoryInterest[],
): Promise<number> {
  const dedup = new Map<string, Record<string, unknown>>();
  for (const row of generated) {
    const user = userByName.get(row.username);
    const gameId = igdbIdsByDbId.get(row.igdbId);
    if (!user || !gameId) continue;
    const key = `${user.id}:${gameId}:${row.source}`;
    if (dedup.has(key)) continue;
    dedup.set(key, {
      userId: user.id,
      gameId,
      source: row.source,
      playtimeForever: row.playtimeForever,
      playtime2weeks: row.playtime2weeks,
      lastSyncedAt: new Date(),
    });
  }
  const values = [...dedup.values()];
  if (values.length === 0) return 0;
  await batchInsert(schema.gameInterests, values, 'doNothing');
  return values.length;
}

/**
 * Re-derive archetypes for every existing `player_taste_vectors` row.
 *
 * The production aggregator short-circuits on matching `signalHash`, so the
 * post-install sequence (aggregate → weekly intensity → re-aggregate) never
 * updates archetypes once the hash is stable. This helper exists purely
 * for demo installs — after `aggregateVectors` has populated vectors and
 * `weeklyIntensityRollup` has written fresh `intensity_metrics`, we
 * recompute archetypes bottom-up using the current metrics + dimensions.
 */
export async function refreshArchetypesFromCurrentMetrics(
  db: PostgresJsDatabase<typeof schema>,
): Promise<number> {
  const rows = await db
    .select({
      userId: schema.playerTasteVectors.userId,
      dimensions: schema.playerTasteVectors.dimensions,
      intensityMetrics: schema.playerTasteVectors.intensityMetrics,
    })
    .from(schema.playerTasteVectors);
  let updated = 0;
  for (const row of rows) {
    const archetype = deriveArchetype({
      intensityMetrics: row.intensityMetrics,
      dimensions: row.dimensions,
    });
    await db
      .update(schema.playerTasteVectors)
      .set({ archetype })
      .where(eq(schema.playerTasteVectors.userId, row.userId));
    updated += 1;
  }
  return updated;
}

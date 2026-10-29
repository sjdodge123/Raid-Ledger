/**
 * Shared archetype re-titling (ROK-1935).
 *
 * The archetype tier is derived from `intensityMetrics`, so every write of
 * a player's intensity metrics must recompute the archetype in the same
 * statement — otherwise the stored title lags the stored metric (the old
 * bug: the weekly intensity job never re-titled anyone). Every
 * intensity-write path goes through `retitleFromIntensity`; update-only
 * paths use `writeIntensityWithTitle`, which wraps it.
 */
import { eq, gt } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  ArchetypeDto,
  IntensityMetricsDto,
  TasteProfileDimensionsDto,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { deriveArchetype } from './archetype.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Intensity metrics + the archetype derived from them, written together. */
export interface IntensityWithTitle {
  intensityMetrics: IntensityMetricsDto;
  archetype: ArchetypeDto;
}

/**
 * Pair intensity metrics with the archetype they imply. The single place
 * that turns metrics into a title — callers persist both fields in ONE
 * statement.
 */
export function retitleFromIntensity(
  intensityMetrics: IntensityMetricsDto,
  dimensions: TasteProfileDimensionsDto,
  hasPresenceData: boolean,
): IntensityWithTitle {
  const archetype = deriveArchetype({
    intensityMetrics,
    dimensions,
    hasPresenceData,
  });
  return { intensityMetrics, archetype };
}

/**
 * The ids of every user WITH presence data.
 *
 * "No presence data" (→ tier `Newcomer`) means: the user has no
 * `game_activity_rollups` row with `total_seconds > 0`, in any period
 * (`day` or `week`), ever. Those rollups are the only input to the
 * intensity score (`weekly-intensity.ts`), so such a user's intensity is
 * unknown rather than low. It is the same population the weekly job skips
 * as having "zero signal across all three tiers".
 */
export async function loadPresenceUserIds(db: Db | Tx): Promise<Set<number>> {
  const rows = await db
    .selectDistinct({ userId: schema.gameActivityRollups.userId })
    .from(schema.gameActivityRollups)
    .where(gt(schema.gameActivityRollups.totalSeconds, 0));
  return new Set(rows.map((r) => r.userId));
}

/**
 * Write a player's intensity metrics (or keep the stored ones when
 * `metrics` is null) and re-derive their archetype in the same UPDATE.
 * Locks the row for the read so a concurrent write can't interleave.
 * Returns false when the user has no taste-vector row yet.
 */
export async function writeIntensityWithTitle(
  tx: Tx,
  userId: number,
  metrics: IntensityMetricsDto | null,
  hasPresenceData: boolean,
): Promise<boolean> {
  const [row] = await tx
    .select({
      dimensions: schema.playerTasteVectors.dimensions,
      intensityMetrics: schema.playerTasteVectors.intensityMetrics,
    })
    .from(schema.playerTasteVectors)
    .where(eq(schema.playerTasteVectors.userId, userId))
    .for('update');
  if (!row) return false;
  const next = retitleFromIntensity(
    metrics ?? row.intensityMetrics,
    row.dimensions,
    hasPresenceData,
  );
  await tx
    .update(schema.playerTasteVectors)
    .set(next)
    .where(eq(schema.playerTasteVectors.userId, userId));
  return true;
}

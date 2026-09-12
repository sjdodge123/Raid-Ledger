/**
 * Seed helpers for the cohort game-frequency aggregation (ROK-1310).
 *
 * Rows are written straight into `community_lineup_cohort_memory` rather than
 * driven through a lineup transition: this slice reads the table, it does not
 * write it, and hand-seeding keeps the cohort sizes/resolutions explicit.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { CohortMemoryResolution } from '../../drizzle/schema/community-lineup-cohort-memory';

type Db = PostgresJsDatabase<typeof schema>;

export interface CohortFrequencySeed {
  /** Cohort member count — drives the bucket under test. */
  size: number;
  gameId: number;
  lineupId: number;
  resolution: CohortMemoryResolution;
  /** Distinguishes two different cohorts of the same size. */
  cohort: string;
}

/** Create `count` games and return their ids, in creation order. */
export async function seedFrequencyGames(
  db: Db,
  count: number,
): Promise<number[]> {
  const rows = await db
    .insert(schema.games)
    .values(
      Array.from({ length: count }, (_, i) => ({
        name: `Freq Game ${i + 1}`,
        slug: `freq-game-${i + 1}`,
        coverUrl: i === 0 ? 'https://img.example/freq-1.jpg' : null,
      })),
    )
    .returning();
  return rows.map((g) => g.id);
}

/** Create a bare lineup usable as `source_lineup_id`. */
export async function seedFrequencyLineup(
  db: Db,
  createdBy: number,
  slug: string,
): Promise<number> {
  const [lineup] = await db
    .insert(schema.communityLineups)
    .values({
      title: `Freq ${slug}`,
      status: 'decided',
      visibility: 'public',
      createdBy,
      publicSlug: slug,
    })
    .returning();
  return lineup.id;
}

/**
 * Insert one cohort-memory row per seed. `participantHash` is synthesised from
 * `cohort` + `size` — the aggregation never re-derives it, it only groups.
 */
export async function seedCohortMemoryRows(
  db: Db,
  seeds: CohortFrequencySeed[],
): Promise<void> {
  await db.insert(schema.communityLineupCohortMemory).values(
    seeds.map((s) => ({
      participantIds: Array.from({ length: s.size }, (_, i) => i + 1),
      participantHash: `hash-${s.cohort}-${s.size}`,
      cohortSize: s.size,
      gameId: s.gameId,
      sourceLineupId: s.lineupId,
      resolution: s.resolution,
    })),
  );
}

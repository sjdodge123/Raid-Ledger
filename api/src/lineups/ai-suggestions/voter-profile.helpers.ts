import { eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Per-voter taste snapshot fed into the curator prompt.
 *
 * Option E (2026-04-22): we moved from "centroid vector only" to
 * "one profile per voter" so the LLM can reason about individual
 * preferences (e.g. "voter_A loves horror but voter_B avoids it —
 * pick something else"). Centroid still available upstream for the
 * multi-voter pgvector query, but the prompt now shows individuals.
 */
export interface VoterProfile {
  userId: number;
  username: string;
  archetype: string | null;
  /** Top-N axes by score, descending. */
  topAxes: { axis: string; score: number }[];
}

/** How many axes per voter we show the LLM — keeps the prompt focused. */
const PROFILE_AXIS_COUNT = 5;

function pickTopAxes(
  dims: Record<string, number> | null,
  n: number,
): { axis: string; score: number }[] {
  if (!dims) return [];
  return Object.entries(dims)
    .map(([axis, score]) => ({ axis, score: Number(score) }))
    .filter((a) => a.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

/**
 * Load one profile per voter: their archetype label and top-5 taste
 * axes. Skips voters who have no `player_taste_vectors` row — those
 * users never showed up in the LLM context anyway because the voter
 * scope helper already filters them out upstream.
 */
export async function loadVoterProfiles(
  db: Db,
  userIds: number[],
): Promise<VoterProfile[]> {
  if (userIds.length === 0) return [];
  const rows = await db
    .select({
      userId: schema.playerTasteVectors.userId,
      username: schema.users.username,
      archetype: schema.playerTasteVectors.archetype,
      dimensions: schema.playerTasteVectors.dimensions,
    })
    .from(schema.playerTasteVectors)
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.playerTasteVectors.userId),
    )
    .where(inArray(schema.playerTasteVectors.userId, userIds));
  return rows.map((r) => ({
    userId: r.userId,
    username: r.username,
    archetype: r.archetype,
    topAxes: pickTopAxes(
      r.dimensions as unknown as Record<string, number> | null,
      PROFILE_AXIS_COUNT,
    ),
  }));
}

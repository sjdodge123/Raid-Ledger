import { eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { loadVoterActivity } from './voter-activity.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Per-voter snapshot fed into the curator prompt.
 *
 * Option E (2026-04-22): "one profile per voter" — taste axes let the
 * LLM reason about preferences; activity signals below give it real
 * behavioural context (what they've been playing on Steam, who they
 * play with, which games they've turned up to community events for).
 * Taste axes are derivative; raw play/co-play/event signals are the
 * source data and give the LLM more room to make independent picks.
 */
/**
 * Shape of the `player_taste_vectors.archetype` jsonb column. The
 * Drizzle schema declares it as text with a `$type<TasteProfileArchetype>`
 * cast, but in practice the pipeline persists a structured object
 * with intensity + per-axis titles. We project down to the fields
 * the curator prompt actually needs.
 */
interface ArchetypeJson {
  vectorTitles?: string[];
  intensityTier?: string;
}

export interface VoterProfile {
  userId: number;
  username: string;
  /** Human-readable archetype labels (e.g. "Architect, Wayfarer"). */
  archetypeLabels: string[];
  /** Intensity tier (e.g. "Casual", "Regular", "Hardcore"). */
  intensityTier: string | null;
  /** Top-N taste axes by score, descending. */
  topAxes: { axis: string; score: number }[];
  /** Top-5 Steam games by playtime in the last 2 weeks. */
  recentlyPlayed: { gameName: string; minutes2Weeks: number }[];
  /** Top-3 community members this voter plays with, by total minutes. */
  coPlayPartners: { username: string; hoursTogether: number }[];
  /** Up-to-3 distinct games this voter signed up for in the last 30 days. */
  recentEventGames: string[];
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
  const [rows, activityByUser] = await Promise.all([
    db
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
      .where(inArray(schema.playerTasteVectors.userId, userIds)),
    loadVoterActivity(db, userIds),
  ]);
  return rows.map((r) => {
    const activity = activityByUser.get(r.userId);
    // `archetype` is declared as text with a $type cast, but the
    // pipeline writes a rich jsonb object. Project down to the
    // prompt-relevant fields, falling back gracefully for legacy
    // string rows.
    const archetypeLabels: string[] = [];
    let intensityTier: string | null = null;
    if (r.archetype && typeof r.archetype === 'object') {
      const obj = r.archetype as unknown as ArchetypeJson;
      if (Array.isArray(obj.vectorTitles))
        archetypeLabels.push(...obj.vectorTitles);
      if (typeof obj.intensityTier === 'string')
        intensityTier = obj.intensityTier;
    } else if (typeof r.archetype === 'string') {
      archetypeLabels.push(r.archetype);
    }
    return {
      userId: r.userId,
      username: r.username,
      archetypeLabels,
      intensityTier,
      topAxes: pickTopAxes(
        r.dimensions as unknown as Record<string, number> | null,
        PROFILE_AXIS_COUNT,
      ),
      recentlyPlayed: activity?.recentlyPlayed ?? [],
      coPlayPartners: activity?.coPlayPartners ?? [],
      recentEventGames: activity?.recentEventGames ?? [],
    };
  });
}

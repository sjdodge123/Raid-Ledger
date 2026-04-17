import type {
  TasteProfileAxis,
  TasteProfileDimensionsDto,
  TasteProfilePoolAxis,
} from '@raid-ledger/contract';
import {
  TASTE_PROFILE_AXES,
  TASTE_PROFILE_AXIS_POOL,
} from '@raid-ledger/contract';
import {
  AXIS_MAPPINGS,
  HIGH_PLAYTIME_WEIGHT_MIN,
} from './axis-mapping.constants';

/**
 * Per-(user, game) signal rollup. Each source contributes up to one entry
 * per game and the weights sum (capped at 1.0 per source by construction).
 */
export interface UserGameSignal {
  gameId: number;
  steamOwnership?: { playtimeForever: number; playtime2weeks: number };
  steamWishlist?: boolean;
  presenceWeeklyHours?: number;
  manualHeart?: boolean;
  eventSignup?: boolean;
  voiceAttendance?: boolean;
  pollSource?: boolean;
}

/**
 * Metadata subset used by the mapper.
 * `tags` are lowercased IsThereAnyDeal/Steam user tags — far richer than
 * IGDB's genre taxonomy. They take priority in axis matching; IGDB IDs
 * act as fallback for games whose tags haven't been fetched yet.
 *
 * Known limitation: tag matching is English-only. ITAD supplies localized
 * tags but we only compare against the English axis-mapping vocabulary,
 * so non-English tag sets silently fall through to the IGDB fallback.
 * Acceptable today because Steam's non-English tag coverage is sparse;
 * revisit if we ever internationalize the axis vocabulary.
 */
export interface GameMetadata {
  gameId: number;
  genres: number[];
  gameModes: number[];
  themes: number[];
  tags: string[];
}

/**
 * Signal-source contribution weights (tuning knobs — adjust here, not
 * inline). The `signalWeight` sum for a single game is intentionally
 * unbounded; self-normalization at the dimensions layer handles the
 * scale.
 */
export const SIGNAL_WEIGHTS = {
  /** Lifetime Steam playtime above this threshold (minutes) → weight 1.0. */
  steamHighPlaytime: 1.0,
  /** Base weight for recent-playtime owners. */
  steamRecentBase: 0.5,
  /** Additive bonus per `playtime2weeks` minute, capped at 0.5. */
  steamRecentCap: 0.5,
  /** Divisor for the recent-playtime bonus: `min(mins/600, cap)`. */
  steamRecentDivisor: 600,
  /** Library-tail ownership with no playtime. Kept tiny so a 1000-game
   *  Steam library doesn't drown out actual play habits via axis
   *  tail-aggregation. */
  steamBareOwnership: 0.02,
  /** Steam wishlist hint. */
  steamWishlist: 0.2,
  /** Presence divisor — weekly hours scaled to [0, 1]. */
  presenceDivisor: 10,
  /** Cap on presence contribution regardless of hours. */
  presenceCap: 1.0,
  /** Manual heart (explicit interest). */
  manualHeart: 0.5,
  /** Signed up for an event for this game. */
  eventSignup: 0.7,
  /** Attended voice for an event — strongest "active interest" signal. */
  voiceAttendance: 1.0,
  /** Auto-hearted via a scheduling poll. */
  pollSource: 0.4,
} as const;

export function signalWeight(signal: UserGameSignal): number {
  let weight = 0;

  if (signal.steamOwnership) {
    const { playtimeForever, playtime2weeks } = signal.steamOwnership;
    if (playtimeForever > HIGH_PLAYTIME_WEIGHT_MIN) {
      weight += SIGNAL_WEIGHTS.steamHighPlaytime;
    } else if (playtime2weeks > 0) {
      weight +=
        SIGNAL_WEIGHTS.steamRecentBase +
        Math.min(
          playtime2weeks / SIGNAL_WEIGHTS.steamRecentDivisor,
          SIGNAL_WEIGHTS.steamRecentCap,
        );
    } else {
      weight += SIGNAL_WEIGHTS.steamBareOwnership;
    }
  }
  if (signal.steamWishlist) weight += SIGNAL_WEIGHTS.steamWishlist;
  if (signal.presenceWeeklyHours !== undefined) {
    weight += Math.min(
      signal.presenceWeeklyHours / SIGNAL_WEIGHTS.presenceDivisor,
      SIGNAL_WEIGHTS.presenceCap,
    );
  }
  if (signal.manualHeart) weight += SIGNAL_WEIGHTS.manualHeart;
  if (signal.eventSignup) weight += SIGNAL_WEIGHTS.eventSignup;
  if (signal.voiceAttendance) weight += SIGNAL_WEIGHTS.voiceAttendance;
  if (signal.pollSource) weight += SIGNAL_WEIGHTS.pollSource;

  return weight;
}

/**
 * Does this game match the given axis?
 * - If the game has tags, match only against the axis's tag list
 *   (trust the richer Steam/ITAD vocabulary).
 * - Otherwise, fall back to IGDB gameMode/genre/theme IDs.
 *
 * Returns 1.0 on match, 0 otherwise. Does NOT depend on per-user signal —
 * classification is purely a property of the game. Used by both the
 * vector computation and `computeAxisIdf` rarity calculation.
 */
export function axisMatchFactor(
  axis: TasteProfilePoolAxis,
  game: GameMetadata,
): number {
  const mapping = AXIS_MAPPINGS[axis];

  if (game.tags.length > 0) {
    return mapping.tags.some((t) => game.tags.includes(t.toLowerCase()))
      ? 1.0
      : 0;
  }

  const hits =
    mapping.gameModes.some((m) => game.gameModes.includes(m)) ||
    mapping.genres.some((g) => game.genres.includes(g)) ||
    mapping.themes.some((t) => game.themes.includes(t));

  return hits ? 1.0 : 0;
}

function zeroedPool(): Record<TasteProfilePoolAxis, number> {
  const init = {} as Record<TasteProfilePoolAxis, number>;
  for (const axis of TASTE_PROFILE_AXIS_POOL) init[axis] = 0;
  return init;
}

/**
 * Compute per-axis rarity weights using the inverse-document-frequency
 * formula: `idf(axis) = ln((N + 1) / (coverage + 1)) + 1`.
 *
 * - Broad axes (e.g. "Adventure" — 200+ games) get a small multiplier.
 * - Specific axes (e.g. "Automation" — ~20 games) get a large one.
 * - Zero-coverage axes get the maximum multiplier (shouldn't dominate
 *   anything because the raw score will still be 0 if nobody hits them).
 *
 * The `+ 1` terms are Laplace smoothing so the formula doesn't divide
 * by zero and stays bounded on a small library.
 */
export function computeAxisIdf(
  games: Map<number, GameMetadata>,
): Record<TasteProfilePoolAxis, number> {
  const idf = {} as Record<TasteProfilePoolAxis, number>;
  const n = games.size;
  const coverage = {} as Record<TasteProfilePoolAxis, number>;
  for (const axis of TASTE_PROFILE_AXIS_POOL) coverage[axis] = 0;

  for (const game of games.values()) {
    for (const axis of TASTE_PROFILE_AXIS_POOL) {
      if (axisMatchFactor(axis, game) > 0) coverage[axis] += 1;
    }
  }
  for (const axis of TASTE_PROFILE_AXIS_POOL) {
    idf[axis] = Math.log((n + 1) / (coverage[axis] + 1)) + 1;
  }
  return idf;
}

/**
 * Compute the full-pool dimensions jsonb (display scale 0–100) + the
 * normalized 7-element vector (for pgvector cosine queries keyed by
 * `TASTE_PROFILE_AXES`).
 *
 * Self-normalized per-user: the user's strongest pool axis maps to 100,
 * so new users and heavy users produce comparable radar shapes. Community
 * normalization (percentile rank) is layered on top by the intensity
 * metrics, not the dimensions vector.
 */
export function computeTasteVector(
  signals: UserGameSignal[],
  games: Map<number, GameMetadata>,
  axisIdf?: Record<TasteProfilePoolAxis, number>,
): { dimensions: TasteProfileDimensionsDto; vector: number[] } {
  const raw = zeroedPool();

  for (const signal of signals) {
    const game = games.get(signal.gameId);
    if (!game) continue;
    const w = signalWeight(signal);
    if (w === 0) continue;
    for (const axis of TASTE_PROFILE_AXIS_POOL) {
      raw[axis] += w * axisMatchFactor(axis, game);
    }
  }

  // Apply rarity (IDF) weighting so specific axes aren't swamped by
  // broad ones that match a huge chunk of the library.
  if (axisIdf) {
    for (const axis of TASTE_PROFILE_AXIS_POOL) {
      raw[axis] *= axisIdf[axis];
    }
  }

  const values = TASTE_PROFILE_AXIS_POOL.map((a) => raw[a]);
  const max = Math.max(0, ...values);
  const dimensions = {} as Record<TasteProfilePoolAxis, number>;
  for (const axis of TASTE_PROFILE_AXIS_POOL) {
    dimensions[axis] = max > 0 ? Math.round((raw[axis] / max) * 100) : 0;
  }

  // Similarity vector stays 7-dim and keyed by the original core axes so
  // the pgvector column and similar-players cosine stay stable.
  const vector = TASTE_PROFILE_AXES.map(
    (axis: TasteProfileAxis) => dimensions[axis] / 100,
  );

  return {
    dimensions: dimensions as TasteProfileDimensionsDto,
    vector,
  };
}

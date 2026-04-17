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
  MMO_PLAYTIME_BONUS_MIN,
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
 */
export interface GameMetadata {
  gameId: number;
  genres: number[];
  gameModes: number[];
  themes: number[];
}

export function signalWeight(signal: UserGameSignal): number {
  let weight = 0;

  if (signal.steamOwnership) {
    const { playtimeForever, playtime2weeks } = signal.steamOwnership;
    if (playtimeForever > MMO_PLAYTIME_BONUS_MIN) {
      weight += 1.0;
    } else if (playtime2weeks > 0) {
      weight += 0.5 + Math.min(playtime2weeks / 600, 0.5);
    } else {
      // Bare ownership (no playtime) is a very weak signal — a 1000-game
      // Steam library shouldn't drown out actual play habits via axis
      // tail-aggregation. Keep just enough to whisper through.
      weight += 0.02;
    }
  }
  if (signal.steamWishlist) weight += 0.2;
  if (signal.presenceWeeklyHours !== undefined) {
    weight += Math.min(signal.presenceWeeklyHours / 10, 1.0);
  }
  if (signal.manualHeart) weight += 0.5;
  if (signal.eventSignup) weight += 0.7;
  if (signal.voiceAttendance) weight += 1.0;
  if (signal.pollSource) weight += 0.4;

  return weight;
}

export function axisMatchFactor(
  axis: TasteProfilePoolAxis,
  game: GameMetadata,
  signal: UserGameSignal,
): number {
  const mapping = AXIS_MAPPINGS[axis];
  const hits =
    mapping.gameModes.some((m) => game.gameModes.includes(m)) ||
    mapping.genres.some((g) => game.genres.includes(g)) ||
    mapping.themes.some((t) => game.themes.includes(t));

  if (hits) return 1.0;

  // MMO playtime bonus: a high-playtime game also drives the MMO axis.
  if (
    axis === 'mmo' &&
    signal.steamOwnership &&
    signal.steamOwnership.playtimeForever > MMO_PLAYTIME_BONUS_MIN
  ) {
    return 1.0;
  }

  return 0;
}

function zeroedPool(): Record<TasteProfilePoolAxis, number> {
  const init = {} as Record<TasteProfilePoolAxis, number>;
  for (const axis of TASTE_PROFILE_AXIS_POOL) init[axis] = 0;
  return init;
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
): { dimensions: TasteProfileDimensionsDto; vector: number[] } {
  const raw = zeroedPool();

  for (const signal of signals) {
    const game = games.get(signal.gameId);
    if (!game) continue;
    const w = signalWeight(signal);
    if (w === 0) continue;
    for (const axis of TASTE_PROFILE_AXIS_POOL) {
      raw[axis] += w * axisMatchFactor(axis, game, signal);
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
